// Batch 3: E.164 phones, contact pagination, billing gates, grace expiry.
import { spawn } from "node:child_process";
import { normalizePhone } from "../relay/shield.js";
import { subscriptionActive } from "../relay/policy.js";
import { checkoutAllowed, USD_PRICES } from "../relay/billing.js";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

ok(normalizePhone("4155552671") === null, "US 10-digit without country is rejected");
ok(normalizePhone("4155552671", "US") === "14155552671", "US number with country becomes E.164");
ok(normalizePhone("9876543210", "IN") === "919876543210", "IN local with explicit country");
ok(normalizePhone("+44 7911 123456") === "447911123456", "international +number accepted without country arg");
ok(normalizePhone("919876543210") === "919876543210", "already-international digits kept");
ok(USD_PRICES.starter.amount === 49 && USD_PRICES.growth.conversations === 10000, "USD guide amounts and quotas");
ok(!checkoutAllowed("starter", { currency: "INR" }).ok, "INR checkout blocked until approved");
ok(subscriptionActive({ plan: "starter", subStatus: "past_due", graceUntil: new Date(Date.now() + 864e5).toISOString() }).ok, "past_due inside grace can send");
ok(!subscriptionActive({ plan: "starter", subStatus: "past_due", graceUntil: new Date(Date.now() - 1000).toISOString() }).ok, "past_due after grace cannot send");

const mongoUri = process.env.BATCH3_MONGO || "mongodb://127.0.0.1:27991/relay_batch3_" + Date.now();
let client;
try { client = new MongoClient(mongoUri); await client.connect(); await client.db().dropDatabase(); }
catch (e) { console.log("FAIL Mongo " + e.message); process.exit(1); }

const srv = spawn(process.execPath, ["server.js"], {
  cwd: API,
  env: {
    ...process.env, NODE_ENV: "production", PORT: "4531", MONGODB_URI: mongoUri,
    AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test",
    CORS_ORIGIN: "http://localhost:3000", WA_VERIFY_TOKEN: "vt",
    WA_APP_SECRET: "wa-secret-wa-secret-wa-secret", RESEND_API_KEY: "re_x", MAIL_FROM: "Relay <t@t.com>",
    TICK_MS: "500",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
async function up() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch("http://127.0.0.1:4531/health")).status === 200) return; } catch {}
    await sleep(200);
  }
  throw new Error("not ready");
}
await up();
const api = async (p, { body, tok, method } = {}) => {
  const r = await fetch("http://127.0.0.1:4531" + p, {
    method: method || (body !== undefined ? "POST" : "GET"),
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(tok ? { authorization: "Bearer " + tok } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { s: r.status, j: await r.json().catch(() => null) };
};

const su = await api("/api/relay/auth/signup", { body: { email: "b3@audit.test", password: "password123", company: "B3 Co" } });
const tok = su.j.token;
const noCountry = await api("/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, contacts: [{ name: "US", phone: "4155552671" }] } });
ok(noCountry.s === 200 && noCountry.j.needCountry >= 1 && noCountry.j.added === 0, "import without country rejects bare local numbers");
const withCountry = await api("/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, country: "US", contacts: [{ name: "US", phone: "4155552671" }, { name: "IN", phone: "9876543210", country: "IN" }] } });
ok(withCountry.j.added === 2, "import with country/default country succeeds");
await api("/api/relay/settings/country", { tok, method: "PUT", body: { defaultCountry: "AE" } });
const ae = await api("/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, contacts: [{ name: "Dubai", phone: "501234567" }] } });
ok(ae.j.added === 1, "org default country used for local numbers");

for (let i = 0; i < 30; i++) {
  await api("/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, country: "IN", contacts: [{ name: "P" + i, phone: "90000000" + String(i).padStart(2, "0") }] } });
}
const page1 = await api("/api/relay/contacts?page=1&limit=10", { tok });
const page2 = await api("/api/relay/contacts?page=2&limit=10", { tok });
const search = await api("/api/relay/contacts?q=Dubai", { tok });
ok(page1.j.contacts.length === 10 && page1.j.pages > 2, "contacts paginated");
ok(page2.j.contacts[0]?.id !== page1.j.contacts[0]?.id, "page 2 differs from page 1");
ok(search.j.total >= 1 && search.j.contacts.some((c) => c.name === "Dubai"), "server-side contact search");

const org = await client.db().collection("orgs").findOne({});
await client.db().collection("orgs").updateOne({ _id: org._id }, { $set: { plan: "starter", subStatus: "past_due", graceUntil: new Date(Date.now() - 1000).toISOString(), paidUntil: new Date(Date.now() + 864e5).toISOString() } });
await sleep(2000);
const after = await client.db().collection("orgs").findOne({ _id: org._id });
ok(after.subStatus === "expired" && new Date(after.paidUntil).getTime() <= Date.now(), "scheduler expires grace and revokes send window");

srv.kill();
await client.close();
console.log(fails ? "FAILS " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
