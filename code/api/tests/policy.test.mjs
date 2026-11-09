// Batch 2: send policy, approved templates, subscription expiry, auth limits, mail redaction.
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const templates = [
  { name: "festive_offer", status: "APPROVED", category: "MARKETING", language: "en", components: [{ type: "BODY", text: "Hi {{1}}" }] },
  { name: "pending_one", status: "PENDING", category: "MARKETING", language: "en", components: [{ type: "BODY", text: "Hi {{1}}" }] },
];
const sends = [];
const mock = http.createServer((q, s) => {
  let b = "";
  q.on("data", (d) => (b += d));
  q.on("end", () => {
    const finish = (code, obj) => { s.writeHead(code, { "content-type": "application/json" }); s.end(JSON.stringify(obj)); };
    if (q.url.includes("/message_templates")) return finish(200, { data: templates });
    if (q.url.startsWith("/123456789012345?")) return finish(200, { quality_rating: "GREEN", messaging_limit_tier: "TIER_1K", verified_name: "Acme", display_phone_number: "+91 90000 00001" });
    if (q.method === "POST" && q.url.includes("/messages")) { sends.push(JSON.parse(b || "{}")); return finish(200, { messages: [{ id: "wamid." + sends.length }] }); }
    finish(200, {});
  });
});
await new Promise((r) => mock.listen(4920, "127.0.0.1", r));

const mailLogs = [];
const origLog = console.log;
console.log = (...a) => { const t = a.map(String).join(" "); if (t.includes("[mail:dev]")) mailLogs.push(t); return origLog(...a); };

const noMail = spawnSync(process.execPath, ["server.js"], {
  cwd: API, encoding: "utf8", timeout: 10000,
  env: { ...process.env, NODE_ENV: "production", PORT: "0", AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test", WA_APP_SECRET: "wa-secret-wa-secret-wa-secret", MONGODB_URI: "mongodb://127.0.0.1:1/none" },
});
ok(noMail.status === 1 && /RESEND_API_KEY/.test(noMail.stderr || ""), "production refuses to start without RESEND_API_KEY");

const mongoUri = process.env.BATCH2_MONGO || "mongodb://127.0.0.1:27991/relay_batch2_" + Date.now();
let client;
try { client = new MongoClient(mongoUri); await client.connect(); await client.db().dropDatabase(); }
catch (e) { origLog("FAIL MongoDB unavailable " + e.message); process.exit(1); }

const base = {
  AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test",
  CORS_ORIGIN: "http://localhost:3000", WA_APP_SECRET: "wa-secret-wa-secret-wa-secret",
  FB_APP_SECRET: "fb-secret-fb-secret-fb-secret", WA_VERIFY_TOKEN: "vt",
  RELAY_ALLOW_LOCAL_PROVIDERS: "1", GRAPH_BASE: "http://127.0.0.1:4920", TICK_MS: "250", CANARY_WAIT_MS: "60000", RELAY_RATE: "50",
  RESEND_API_KEY: "re_test", MAIL_FROM: "Relay <test@example.com>", RESEND_BASE: "http://127.0.0.1:1",
};
function boot(port, extra = {}) {
  return spawn(process.execPath, ["server.js"], {
    cwd: API, env: { ...process.env, ...base, NODE_ENV: "production", MONGODB_URI: mongoUri, PORT: String(port), ...extra },
    stdio: ["ignore", "ignore", "pipe"],
  });
}
async function up(port) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch("http://127.0.0.1:" + port + "/health"); if (r.status === 200) return; } catch {}
    await sleep(200);
  }
  throw new Error("not ready " + port);
}
const api = async (port, p, { body, tok, headers, method, key } = {}) => {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const r = await fetch("http://127.0.0.1:" + port + p, {
    method: method || (raw !== undefined ? "POST" : "GET"),
    headers: {
      ...(raw !== undefined ? { "content-type": "application/json" } : {}),
      ...(tok ? { authorization: "Bearer " + tok } : {}),
      ...(key ? { "x-api-key": key } : {}),
      ...(headers || {}),
    },
    body: raw,
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
};

const srv = boot(4521);
await up(4521);
const su = await api(4521, "/api/relay/auth/signup", { body: { email: "batch2@audit.test", password: "password123", company: "Batch2 Co" } });
ok(su.s === 201, "signup");
const tok = su.j.token;
await api(4521, "/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, contacts: [{ name: "A", phone: "919200000001" }, { name: "B", phone: "919200000002" }] } });
await api(4521, "/api/relay/wa/connect", { tok, body: { phoneId: "123456789012345", wabaId: "999888777", token: "EAA" + "y".repeat(30) } });

const badTpl = await api(4521, "/api/relay/campaigns", { tok, body: { name: "Pend", templateName: "pending_one", lang: "en", consent: true, varCols: ["name"] } });
ok(badTpl.s === 400 && /APPROVED|approved|status/i.test(badTpl.j?.error || ""), "unapproved template rejected on campaign create");

const keyRes = await api(4521, "/api/relay/api-key", { tok, body: {} });
ok(keyRes.s === 200 && keyRes.j.key, "api key created");
const key = keyRes.j.key;

const apiPend = await api(4521, "/api/relay/v1/send", { key, body: { to: "919200000001", template: "pending_one", lang: "en", vars: ["A"] } });
ok(apiPend.s === 400 && apiPend.j?.reason === "template_unapproved", "API key send rejects unapproved template");

const apiOk = await api(4521, "/api/relay/v1/send", { key, body: { to: "919200000001", template: "festive_offer", lang: "en", vars: ["A"] } });
ok(apiOk.s === 200 && apiOk.j.ok, "API key send allowed for approved template with consent");
const apiFreq = await api(4521, "/api/relay/v1/send", { key, body: { to: "919200000001", template: "festive_offer", lang: "en", vars: ["A"] } });
ok(apiFreq.s === 403 && apiFreq.j?.reason === "frequency_24h", "API key send enforces frequency");

await client.db().collection("orgs").updateOne({}, { $set: { plan: "starter", paidUntil: new Date(Date.now() - 864e5).toISOString() } });
const expiredCamp = await api(4521, "/api/relay/campaigns", { tok, body: { name: "Late", templateName: "festive_offer", lang: "en", consent: true, varCols: ["name"] } });
ok(expiredCamp.s === 402, "expired subscription blocks new campaigns");
const apiExp = await api(4521, "/api/relay/v1/send", { key, body: { to: "919200000002", template: "festive_offer", lang: "en", vars: ["B"] } });
ok(apiExp.s === 402 && apiExp.j?.reason === "subscription_expired", "API key send blocked when subscription expired");

await client.db().collection("orgs").updateOne({}, { $set: { plan: "starter", paidUntil: new Date(Date.now() + 10 * 864e5).toISOString() } });
await client.db().collection("contacts").updateOne({ phone: "919200000001" }, { $set: { mkt: [], optedOut: true } });
const stopSend = await api(4521, "/api/relay/v1/send", { key, body: { to: "919200000001", template: "festive_offer", lang: "en", vars: ["A"] } });
ok(stopSend.s === 403 && stopSend.j?.reason === "opted_out", "STOP / opted-out blocks API send");

await client.db().collection("contacts").updateOne({ phone: "919200000002" }, { $set: { mkt: [], optedOut: false } });
const more = Array.from({ length: 8 }, (_, i) => ({ name: "C" + i, phone: "91930000000" + i }));
await api(4521, "/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, contacts: more } });
const camp = await api(4521, "/api/relay/campaigns", { tok, body: { name: "Run", templateName: "festive_offer", lang: "en", consent: true, varCols: ["name"] } });
ok(camp.s === 201, "campaign starts while subscription active");
await client.db().collection("orgs").updateOne({}, { $set: { paidUntil: new Date(Date.now() - 1000).toISOString() } });
await sleep(2000);
const paused = await client.db().collection("campaigns").findOne({ _id: camp.j.id });
ok(paused?.status === "paused" && /subscription|ended|Renew/i.test(paused?.pauseReason || ""), "running campaign pauses when subscription expires (" + paused?.status + ")");

const unsigned = await api(4521, "/api/relay/webhook", { body: { entry: [] } });
ok(unsigned.s === 401, "unsigned webhook still rejected after rate-limit split");

const login1 = await api(4521, "/api/relay/auth/login", { body: { email: "batch2@audit.test", password: "password123" } });
ok(login1.s === 200, "login works");
const oldTok = login1.j.token;
await api(4521, "/api/relay/auth/forgot", { body: { email: "batch2@audit.test" } });
const u = await client.db().collection("users").findOne({ email: "batch2@audit.test" });
// Direct reset via DB hash path: call reset with a forged flow — use password endpoint instead
const pw = await api(4521, "/api/relay/auth/password", { tok: oldTok, body: { current: "password123", password: "password999" } });
ok(pw.s === 200 && pw.j.token, "password change returns new session");
ok((await api(4521, "/api/relay/me", { tok: oldTok })).s === 401, "old session revoked after password change");
ok((await api(4521, "/api/relay/me", { tok: pw.j.token })).s === 200, "new session works");

process.env.NODE_ENV = "development";
delete process.env.RESEND_API_KEY;
const { sendMail } = await import("../relay/mail.js");
mailLogs.length = 0;
await sendMail("x@y.com", "Reset", "Reset your password: https://relay.test/app?reset=abcdef0123456789abcdef0123456789");
ok(mailLogs.some((l) => l.includes("[redacted]") || l.includes("[redacted-token]")) && !mailLogs.some((l) => /reset=abcdef/.test(l)), "reset URLs are redacted from logs");

srv.kill();
await client.close();
mock.close();
console.log = origLog;
console.log(fails ? "FAILS " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
