#!/usr/bin/env node
// Scry MCP — keyless, read-only bridge to the Scry Solana wallet intelligence API.
//
// Design (deliberately custody-free): this server holds no keys and never moves funds.
// Free discovery surfaces (coverage pre-check, catalog) are proxied directly. For paid
// evidence it returns the exact x402 endpoint URL + price + payment instructions, so the
// calling agent settles the USDC payment with ITS OWN wallet against the hardened Scry
// HTTPS API. That keeps this bridge zero-secret and zero-attack-surface.
//
// Run: npx scry-mcp   (stdio transport; works with Claude Desktop / Cursor / any MCP client)
// NOTE: stdio server — NOTHING may be written to stdout except JSON-RPC. Diagnostics -> stderr.

import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const require = createRequire(import.meta.url);
const PKG = require("./package.json");

const BASE = "https://scry.solanahub.de";
const UA = `scry-mcp/${PKG.version}`;
const FETCH_TIMEOUT_MS = 15000;

// Base58, 32-44 chars — same rule the Scry API enforces for wallets and mints.
const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function getJson(path, signal) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: combined,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
}

function upstreamErrorMessage(status) {
  if (status === 429) return "Scry API rate limit hit. Retry in about 60 seconds.";
  if (status === 404) return "Not found on the Scry API (wallet or route unknown).";
  if (status >= 500) return "Scry API is temporarily unavailable. Retry shortly.";
  return `Scry API returned HTTP ${status}.`;
}

function catalogProducts(body) {
  // Marketplace alias entries duplicate canonical products and silently swallow
  // address substitution — never surface them to agents.
  return (body.products || []).filter((p) => !String(p.id || "").includes("_alias_"));
}

const TOOLS = [
  {
    name: "scry_coverage_check",
    title: "Scry coverage pre-check (free)",
    description:
      "Free pre-check: is a Solana wallet inside Scry's indexed cohort before you pay for deeper evidence? Returns coverage status, confidence band, and whether the wallet is indexed. No payment, no keys. Not useful for wallets outside Solana.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Solana wallet address, base58, 32-44 chars (e.g. 4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk)",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "scry_catalog",
    title: "Scry paid-endpoint catalog (free)",
    description:
      "Free: list the Scry x402 paid endpoints with their exact product ids, prices, and request objects. Call this FIRST, then pass the exact id to scry_paid_endpoint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "scry_paid_endpoint",
    title: "Resolve a paid Scry x402 endpoint (free; payment happens agent-side)",
    description:
      "Free: given an exact Scry product id from scry_catalog (e.g. wallet_address_quick_flag, wallet_address_forensics, solana_hot_wallets_daily) plus a wallet or mint where required, return the exact x402 endpoint URL, price, and payment instructions. The calling agent pays this URL directly with its own x402/USDC wallet — this bridge never custodies funds. Call scry_catalog first if you do not know the exact id.",
    inputSchema: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Exact product id from scry_catalog. Ambiguous fragments are rejected with a candidate list.",
        },
        address: {
          type: "string",
          description: "Solana wallet address (base58, 32-44 chars) for wallet-scoped products",
        },
        address_b: {
          type: "string",
          description: "Second Solana wallet address for pairwise products (wallet connection)",
        },
        mint: {
          type: "string",
          description: "Solana mint address (base58, 32-44 chars) for mint-scoped products",
        },
      },
      required: ["product"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

const server = new Server(
  { name: "scry-mcp", version: PKG.version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const { name, arguments: args = {} } = req.params;
  const signal = extra?.signal;
  try {
    if (name === "scry_coverage_check") {
      const address = String(args.address || "").trim();
      if (!SOLANA_ADDR.test(address)) {
        return toolError("Provide a valid Solana wallet address: base58, 32-44 characters.");
      }
      const { status, body } = await getJson(`/x402/coverage/${encodeURIComponent(address)}`, signal);
      if (status !== 200) return toolError(upstreamErrorMessage(status));
      return toolJson(body);
    }

    if (name === "scry_catalog") {
      const { status, body } = await getJson(`/x402/products.json`, signal);
      if (status !== 200) return toolError(upstreamErrorMessage(status));
      const products = catalogProducts(body).map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        price: p.price,
        request_object: p.entry_role || p.requester_job,
      }));
      return toolJson({ count: products.length, products, catalog_url: `${BASE}/x402/products.json` });
    }

    if (name === "scry_paid_endpoint") {
      const product = String(args.product || "").trim().replace(/^\/+/, "");
      if (!product) return toolError("Provide a product id. Call scry_catalog to list available ids.");

      const { status, body } = await getJson(`/x402/products.json`, signal);
      if (status !== 200) return toolError(upstreamErrorMessage(status));
      const products = catalogProducts(body);

      // 1) exact id match; 2) unique last-path-segment match; 3) otherwise reject
      // with candidates — this tool's output gets PAID by the agent, so a silent
      // wrong match (wrong product, wrong price) is never acceptable.
      let match = products.find((p) => p.id === product);
      if (!match) {
        const segmentMatches = products.filter(
          (p) => String(p.path || "").split("/").filter(Boolean).pop() === product
        );
        if (segmentMatches.length === 1) match = segmentMatches[0];
        else {
          const candidates = (segmentMatches.length > 1 ? segmentMatches : products.filter((p) => String(p.id).includes(product) || String(p.path || "").includes(product)))
            .slice(0, 8)
            .map((p) => `${p.id} (${p.price})`);
          return toolError(
            candidates.length
              ? `Ambiguous or unknown product "${product}". Pass one exact id: ${candidates.join(", ")}`
              : `Unknown product "${product}". Call scry_catalog to list available ids.`
          );
        }
      }

      const path = String(match.path || "");
      const needsAddress = path.includes(":address") || path.includes("connection");
      const needsMint = path.includes(":mint");
      const address = String(args.address || "").trim();
      const addressB = String(args.address_b || "").trim();
      const mint = String(args.mint || "").trim();

      if (needsAddress) {
        if (!address) return toolError(`Product "${match.id}" requires the "address" parameter (base58 Solana wallet).`);
        if (!SOLANA_ADDR.test(address)) return toolError('Invalid "address": expected base58, 32-44 characters.');
      }
      if (needsMint) {
        if (!mint) return toolError(`Product "${match.id}" requires the "mint" parameter (base58 Solana mint).`);
        if (!SOLANA_ADDR.test(mint)) return toolError('Invalid "mint": expected base58, 32-44 characters.');
      }

      let url;
      if (path.includes("connection")) {
        if (!addressB) return toolError(`Product "${match.id}" is pairwise and requires "address_b" (second base58 wallet).`);
        if (!SOLANA_ADDR.test(addressB)) return toolError('Invalid "address_b": expected base58, 32-44 characters.');
        url = `${BASE}/x402/wallet/connection?a=${encodeURIComponent(address)}&b=${encodeURIComponent(addressB)}`;
      } else {
        url = `${BASE}${path
          .replace(":address", encodeURIComponent(address))
          .replace(":mint", encodeURIComponent(mint))}`;
      }

      return toolJson({
        product: match.id,
        endpoint: url,
        price: match.price,
        payment: "x402 v2 exact USDC on Solana or Base rails. No API keys, no account.",
        how_to_pay:
          "GET the endpoint, read the HTTP 402 PAYMENT-REQUIRED header (base64 x402 v2 accepts[]), sign the USDC payment with your own wallet, retry with the X-PAYMENT header.",
        note: "This bridge does not custody funds; you pay the Scry API directly.",
      });
    }

    return toolError(`Unknown tool: ${name}`);
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return toolError("Request timed out or was cancelled. The Scry API may be slow; retry shortly.");
    }
    return toolError(`scry-mcp error: ${String(err?.message || err).slice(0, 200)}`);
  }
});

function toolJson(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}
function toolError(msg) {
  return { content: [{ type: "text", text: msg }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
