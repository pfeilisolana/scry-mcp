#!/usr/bin/env node
/**
 * Scry Wallet Intelligence — MCP server (read-only, dependency-free).
 *
 * Opens the MCP discovery door (G2): MCP-native agents (Claude/Cursor/Codex) can
 * discover + understand Scry's x402 endpoints via `tools/list`. Tools are generated
 * DYNAMICALLY from the live x402 manifest (/.well-known/x402.json), so they stay in
 * sync with the ~34 endpoints automatically — no hardcoded duplication.
 *
 * Design / safety:
 * - ALL tools are read-only, idempotent, non-destructive (annotations set).
 * - No wallet, no key, no money movement. FREE tools (coverage probe, manifest) are
 *   fetched live and returned. PAID endpoints return the x402 payment requirements
 *   (price, network, asset=USDC, payTo) + instructions, so the agent's own x402 wallet
 *   can pay and call the HTTP endpoint directly. The MCP server never holds funds.
 * - Dependency-free: minimal correct JSON-RPC 2.0 over newline-delimited stdio
 *   (MCP stdio transport). No npm supply-chain surface.
 * - Neutral evidence DNA preserved: descriptions say "facts, not verdicts".
 *
 * Run:  SCRY_BASE_URL=https://scry.solanahub.de node server.mjs   (stdio MCP)
 */

const BASE_URL = (process.env.SCRY_BASE_URL || "https://scry.solanahub.de").replace(/\/$/, "");
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "scry-wallet-intelligence", version: "0.1.0" };

const log = (...a) => process.stderr.write(`[scry-mcp] ${a.join(" ")}\n`); // stdout is the protocol channel

// ─── manifest → tools ───────────────────────────────────────────────────────
function toolName(path) {
  return ("scry_" + String(path).replace(/^\/x402\//, "").replace(/[^a-zA-Z0-9]+/g, "_"))
    .replace(/_+/g, "_").replace(/_$/, "").slice(0, 64);
}

function inputSchemaFor(endpoint) {
  const q = endpoint?.input_schema?.query;
  if (q && typeof q === "object") {
    const properties = {}; const required = [];
    for (const [k, v] of Object.entries(q)) {
      properties[k] = { type: (v && v.type) || "string", description: (v && v.description) || undefined };
      if (v && v.required) required.push(k);
    }
    if (Object.keys(properties).length) return { type: "object", properties, required };
  }
  // sensible default: most endpoints accept ?address=
  return { type: "object", properties: { address: { type: "string", description: "Solana wallet/mint address (base58)" } } };
}

async function fetchManifest() {
  const res = await fetch(`${BASE_URL}/.well-known/x402.json`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`manifest http ${res.status}`);
  return res.json();
}

function buildTools(manifest) {
  const tools = [];
  const seen = new Set();
  // explicit FREE discovery tools (no payment)
  tools.push({
    name: "scry_coverage_probe",
    description: "FREE. Check whether a Solana wallet is inside Scry's indexed cohort BEFORE paying (coverage_status + computed_at). Read-only, no payment. Returns facts, not verdicts.",
    inputSchema: { type: "object", properties: { address: { type: "string", description: "base58 Solana wallet address" } }, required: ["address"] },
    annotations: { title: "Scry coverage probe (free)", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    _scry: { kind: "free", httpPath: "/x402/coverage/{address}" },
  });
  tools.push({
    name: "scry_manifest",
    description: "FREE. Fetch Scry's full x402 machine manifest (all endpoints, typed input/output schemas, prices, payment rails). Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Scry manifest (free)", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    _scry: { kind: "free", httpPath: "/.well-known/x402.json" },
  });
  seen.add("scry_coverage_probe"); seen.add("scry_manifest");
  for (const ep of (manifest.endpoints || [])) {
    const path = ep.path || ep.resource || ep.url;
    if (!path || String(path).includes("{") === false && seen.has(toolName(path))) {
      if (seen.has(toolName(path))) continue;
    }
    const name = toolName(path);
    if (seen.has(name)) continue; // dedup canonical vs alias paths
    seen.add(name);
    const price = ep.price || ep.maxAmountRequired || "see manifest";
    tools.push({
      name,
      description: `PAID (${price} via x402, USDC). ${ep.description || ep.one_liner || path}. Returns NEUTRAL evidence with per-field provenance/freshness/confidence — facts, not verdicts. Calling this tool returns the x402 payment requirements (price, network, asset, payTo) so your x402 wallet can pay and call ${path} directly.`,
      inputSchema: inputSchemaFor(ep),
      annotations: { title: `Scry ${name} (paid ${price})`, readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      _scry: { kind: "paid", httpPath: path, price },
    });
  }
  return tools;
}

// ─── tool execution ─────────────────────────────────────────────────────────
function buildQuery(args) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(args || {})) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function callTool(tool, args) {
  if (tool._scry.kind === "free") {
    const url = tool._scry.httpPath.includes("{address}")
      ? `${BASE_URL}/x402/coverage/${encodeURIComponent(args.address || "")}`
      : `${BASE_URL}${tool._scry.httpPath}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const body = await res.text();
    let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
    return { content: [{ type: "text", text: typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2) }], structuredContent: typeof parsed === "object" ? parsed : undefined };
  }
  // paid: surface the x402 payment requirements (do NOT pay — agent's wallet does)
  const url = `${BASE_URL}${tool._scry.httpPath.replace("{address}", encodeURIComponent(args.address || ""))}${tool._scry.httpPath.includes("{") ? "" : buildQuery(args)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  let accepts = null;
  const prHeader = res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED");
  if (prHeader) { try { accepts = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8")); } catch { /* keep raw below */ } }
  const guidance = {
    status: res.status,
    paid_endpoint: `${BASE_URL}${tool._scry.httpPath}`,
    price: tool._scry.price,
    how_to_pay: "Use an x402 v2 client (e.g. @x402/fetch or `npx awal x402 pay`) to sign a USDC payment from the PAYMENT-REQUIRED requirements, then GET this endpoint with the X-PAYMENT header. USDC on Solana mainnet or Base.",
    payment_requirements: accepts || prHeader || "see /.well-known/x402.json",
    note: "Scry returns NEUTRAL evidence (provenance, freshness, confidence) — facts, not verdicts. This MCP server does not hold funds or execute payment.",
  };
  return { content: [{ type: "text", text: JSON.stringify(guidance, null, 2) }], structuredContent: guidance };
}

// ─── JSON-RPC 2.0 over newline-delimited stdio (MCP stdio transport) ─────────
let TOOLS = [];
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function replyError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO,
      instructions: "Scry: neutral on-chain evidence for Solana wallets/mints via x402. Free coverage probe + manifest; paid endpoints return x402 payment requirements. Facts, not verdicts." });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return; // notifications: no reply
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    if (!TOOLS.length) {
      try { TOOLS = buildTools(await fetchManifest()); }
      catch (e) { log("manifest fetch failed:", e.message); TOOLS = buildTools({ endpoints: [] }); }
    }
    // strip internal _scry before sending
    return reply(id, { tools: TOOLS.map(({ _scry, ...t }) => t) });
  }
  if (method === "tools/call") {
    if (!TOOLS.length) { try { TOOLS = buildTools(await fetchManifest()); } catch { TOOLS = buildTools({ endpoints: [] }); } }
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return replyError(id, -32602, `unknown tool: ${params?.name}`);
    try { return reply(id, await callTool(tool, params.arguments || {})); }
    catch (e) { return reply(id, { content: [{ type: "text", text: `error: ${e.message}` }], isError: true }); }
  }
  if (typeof id !== "undefined") return replyError(id, -32601, `method not found: ${method}`);
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { log("bad json line"); continue; }
    Promise.resolve(handle(msg)).catch((e) => log("handler error:", e.message));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready · base=${BASE_URL}`);
