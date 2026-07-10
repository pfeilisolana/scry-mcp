# scry-mcp

A **keyless, custody-free** MCP server that bridges AI agents to
[Scry](https://scry.solanahub.de/x402/service.json) — Solana wallet intelligence
paid per request via [x402](https://www.x402.org/).

It holds no private keys and never moves funds. Free discovery tools are proxied
directly; for paid evidence it hands the agent the exact x402 endpoint URL and
price, and the agent settles the USDC payment with **its own** wallet against the
Scry HTTPS API.

## Tools

| Tool | Cost | What it does |
|------|------|--------------|
| `scry_coverage_check` | free | Is a Solana wallet inside Scry's indexed cohort before you pay? Returns coverage status, confidence band, indexed flag. |
| `scry_catalog` | free | List the paid Scry x402 endpoints with prices and request objects. |
| `scry_paid_endpoint` | free | Given a product id + wallet/mint, return the exact x402 URL, price, and how-to-pay. The agent then pays the Scry API directly. |

## What agents can ask

Scry is most useful when an agent already knows the research object and needs a
bounded evidence route rather than a generic score:

- **Solana wallet forensics:** resolve the full one-wallet evidence dossier with
  coverage, provenance, freshness, and caveats.
- **Solana wallet source of funds:** find the funding-lineage route and inspect
  upstream funders, hop depth, and freshness before payment.
- **Pump.fun wallet cohort risk:** select the cohort-screening route before
  spending on individual wallet dossiers.

Example prompts:

```text
Check whether this Solana wallet is covered by Scry before I approve a paid dossier.
```

```text
Find the Scry route for tracing who funded a Solana wallet. Show the exact price,
input object, and caveats, but do not pay.
```

```text
Resolve the Scry Pump.fun wallet-cohort evidence route and explain what it is not for.
```

## Install (Claude Desktop / Cursor / any MCP client)

```json
{
  "mcpServers": {
    "scry": { "command": "npx", "args": ["-y", "scry-mcp"] }
  }
}
```

Requires Node.js >= 20. No API keys, no account, no wallet configuration for the
free tools. To actually pay for evidence, your agent needs its own x402 payment
layer (for example an x402 client wallet); this bridge only tells it where and
how much.

## Security posture

- **No custody, no secrets:** the server never holds keys or funds; paid calls
  are settled by the agent's own wallet directly against the Scry HTTPS API.
- **Strict input validation:** wallet and mint arguments must be base58
  (32-44 chars) and are URL-encoded; ambiguous product ids are rejected with a
  candidate list instead of silently resolving to the wrong (priced) endpoint.
- **Read-only:** all three tools are GET-only against one fixed host
  (scry.solanahub.de); there is no way to point this server at another host.
- **Small and auditable:** a single ~250-line file, one direct dependency
  (the official `@modelcontextprotocol/sdk`), no install scripts.

## Why keyless

Scry's paid API is already hardened and settles x402 payments directly to its own
receiver. This bridge deliberately does not re-implement that or custody funds —
it exposes the free surfaces and brokers the paid ones, which keeps it zero-secret
and safe to run anywhere.

## Links

- Service manifest: <https://scry.solanahub.de/x402/service.json>
- Product catalog: <https://scry.solanahub.de/x402/products.json>
- Discovery: <https://scry.solanahub.de/x402/discovery.json>
- Human docs: <https://solanahub.de/en/scry/agent-discovery/>
- Runnable payment examples: <https://github.com/pfeilisolana/scry-x402-examples>

## License

MIT
