// Minimal stdio MCP client smoke test: list tools + call each.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["index.mjs"] });
const client = new Client({ name: "smoke", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));

const cov = await client.callTool({ name: "scry_coverage_check", arguments: { address: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk" } });
console.log("\ncoverage_check ->", cov.content[0].text.slice(0, 160));

const cat = await client.callTool({ name: "scry_catalog", arguments: {} });
console.log("\ncatalog ->", cat.content[0].text.slice(0, 140));

const paid = await client.callTool({ name: "scry_paid_endpoint", arguments: { product: "forensics", address: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk" } });
console.log("\npaid_endpoint ->", paid.content[0].text.slice(0, 220));

await client.close();
console.log("\nSMOKE OK");
