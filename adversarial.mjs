// Real adversarial test: broken args, injection strings, ambiguity, stdout cleanliness.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["index.mjs"] });
const client = new Client({ name: "adversarial", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

let pass = 0, fail = 0;
async function expectError(name, args, mustContain) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || "";
  const ok = r.isError === true && (!mustContain || text.toLowerCase().includes(mustContain.toLowerCase()));
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(args).slice(0, 70)} -> isError=${r.isError} "${text.slice(0, 70)}"`);
  ok ? pass++ : fail++;
}
async function expectOk(name, args, mustContain) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || "";
  const ok = !r.isError && (!mustContain || text.includes(mustContain));
  console.log(`${ok ? "PASS" : "FAIL"} ${name} -> ok "${text.slice(0, 60).replace(/\n/g, " ")}"`);
  ok ? pass++ : fail++;
}

const GOOD = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2zoJjhMSsNG".slice(0, 0) || "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
const GOOD2 = "DN7pYLSGYqHXwvPLh8tJM2zoJjhMSsNGVRVkMWVpredr";

// coverage_check
await expectError("scry_coverage_check", {}, "base58");
await expectError("scry_coverage_check", { address: "" }, "base58");
await expectError("scry_coverage_check", { address: "abc" }, "base58");
await expectError("scry_coverage_check", { address: "../../../etc/passwd" }, "base58");
await expectError("scry_coverage_check", { address: GOOD + "?x=1#frag" }, "base58");
await expectError("scry_coverage_check", { address: "A".repeat(500) }, "base58");
await expectOk("scry_coverage_check", { address: GOOD }, "coverage_status");

// catalog
await expectOk("scry_catalog", {}, "products");
{
  const r = await client.callTool({ name: "scry_catalog", arguments: {} });
  const hasAlias = (r.content?.[0]?.text || "").includes("_alias_");
  console.log(`${hasAlias ? "FAIL" : "PASS"} scry_catalog enthält keine _alias_-Einträge`);
  hasAlias ? fail++ : pass++;
}

// paid_endpoint: unknown/ambiguous/injection
await expectError("scry_paid_endpoint", {}, "product id");
await expectError("scry_paid_endpoint", { product: "definitely-not-real" }, "Unknown product");
await expectError("scry_paid_endpoint", { product: "wallet" }, "exact id");
await expectError("scry_paid_endpoint", { product: "https://evil.example/steal" }, "");
// missing required params
await expectError("scry_paid_endpoint", { product: "wallet_address_forensics" }, "address");
await expectError("scry_paid_endpoint", { product: "wallet_address_forensics", address: "nope" }, "base58");
// injection into address
await expectError("scry_paid_endpoint", { product: "wallet_address_forensics", address: GOOD + "/../admin" }, "base58");
// happy paths
await expectOk("scry_paid_endpoint", { product: "wallet_address_forensics", address: GOOD }, "/x402/wallet/" + GOOD + "/forensics");
await expectOk("scry_paid_endpoint", { product: "quick-flag", address: GOOD }, "quick-flag");
// connection pairwise
await expectError("scry_paid_endpoint", { product: "wallet_connection", address: GOOD }, "address_b");
await expectOk("scry_paid_endpoint", { product: "wallet_connection", address: GOOD, address_b: GOOD2 }, "a=" + GOOD);
// unknown tool
await expectError("nope_tool", {}, "Unknown tool");

await client.close();
console.log(`\nERGEBNIS: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
