// Smoke test: spawn the MCP server, run initialize -> tools/list -> tools/call, print responses.
import { spawn } from "node:child_process";

const base = process.env.SCRY_BASE_URL || "http://127.0.0.1:4020";
const srv = spawn("node", ["server.mjs"], { env: { ...process.env, SCRY_BASE_URL: base }, cwd: import.meta.dirname });

let out = "";
srv.stdout.on("data", (d) => (out += d));
srv.stderr.on("data", (d) => process.stderr.write(d));

const send = (m) => srv.stdin.write(JSON.stringify(m) + "\n");

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "scry_coverage_probe", arguments: { address: "So11111111111111111111111111111111111111112" } } });

setTimeout(() => {
  srv.kill();
  const lines = out.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return l; } });
  for (const r of lines) {
    if (r.id === 1) console.log("INIT:", r.result?.serverInfo?.name, "proto", r.result?.protocolVersion);
    else if (r.id === 2) {
      const tools = r.result?.tools || [];
      console.log(`TOOLS/LIST: ${tools.length} tools`);
      console.log("  free:", tools.filter((t) => /free/i.test(t.description)).map((t) => t.name).join(", "));
      console.log("  sample paid:", tools.filter((t) => /PAID/.test(t.description)).slice(0, 4).map((t) => t.name).join(", "));
      const bad = tools.filter((t) => !/^[a-zA-Z0-9_-]+$/.test(t.name));
      console.log("  invalid tool names:", bad.length);
      const ro = tools.every((t) => t.annotations?.readOnlyHint === true);
      console.log("  all readOnly:", ro);
    } else if (r.id === 3) {
      console.log("TOOLS/CALL coverage_probe:", JSON.stringify(r.result?.structuredContent || r.result?.content?.[0]?.text || r.result).slice(0, 200));
    }
  }
  console.log(lines.length >= 3 ? "SMOKE PASS" : "SMOKE INCOMPLETE");
}, 6000);
