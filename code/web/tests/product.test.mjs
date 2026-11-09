import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const product = JSON.parse(readFileSync(join(root, "lib/product.json"), "utf8"));
const company = readFileSync(join(root, "lib/company.js"), "utf8");
const nextCfg = readFileSync(join(root, "next.config.mjs"), "utf8");
const wa = readFileSync(join(root, "components/WaApp.jsx"), "utf8");

assert.equal(product.name, "Relay");
assert.match(product.note || "", /Mira|multi-agent/i);
assert.doesNotMatch(product.desc + product.line, /\bMira handoff is live\b/i);
assert.match(company, /NEXT_PUBLIC_COMPANY_LEGAL_NAME/);
assert.match(nextCfg, /API_URL/);
assert.match(wa, /\/api\/relay/);
assert.doesNotMatch(wa, /\/api\/pulse/);

console.log("PASS web product/scope and API prefix checks");
