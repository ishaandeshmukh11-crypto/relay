// Batch 1: production database gate, webhook durability, and single-send claims.
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
const sends = [];
let hang = false;
const mock = http.createServer((q, s) => {
  let b = "";
  q.on("data", (d) => (b += d));
  q.on("end", () => {
    const finish = (code, obj) => { if (!s.headersSent) { s.writeHead(code, { "content-type": "application/json" }); s.end(JSON.stringify(obj)); } };
    if (q.url.includes("/message_templates")) return finish(200, { data: [{ name: "festive_offer", status: "APPROVED", category: "MARKETING", language: "en", components: [{ type: "BODY", text: "Hi {{1}}" }] }] });
    if (q.url.startsWith("/123456789012345?")) return finish(200, { quality_rating: "GREEN", messaging_limit_tier: "TIER_1K", verified_name: "Acme", display_phone_number: "+91 90000 00001" });
    if (q.method === "POST" && q.url.includes("/messages")) {
      sends.push(Date.now());
      if (hang) return;
      return setTimeout(() => finish(200, { messages: [{ id: "wamid." + sends.length + "." + crypto.randomBytes(4).toString("hex") }] }), 300);
    }
    finish(200, { data: [] });
  });
});
await new Promise((r) => mock.listen(4919, "127.0.0.1", r));

const base = {
  AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test",
  CORS_ORIGIN: "http://localhost:3000", WA_APP_SECRET: "wa-secret-wa-secret-wa-secret",
  FB_APP_SECRET: "fb-secret-fb-secret-fb-secret", WA_VERIFY_TOKEN: "vt",
  RELAY_ALLOW_LOCAL_PROVIDERS: "1", GRAPH_BASE: "http://127.0.0.1:4919", TICK_MS: "200", CANARY_WAIT_MS: "60000", RELAY_RATE: "50",
  WA_FETCH_TIMEOUT_MS: "20000", RESEND_API_KEY: "re_test", MAIL_FROM: "Relay <test@example.com>",
};
const mongoUri = process.env.BATCH1_MONGO || "mongodb://127.0.0.1:27991/relay_batch1_" + Date.now();

function boot(port, extra = {}) {
  return spawn(process.execPath, ["server.js"], {
    cwd: API, env: { ...process.env, ...base, NODE_ENV: "production", MONGODB_URI: mongoUri, PORT: String(port), ...extra },
    stdio: ["ignore", "ignore", "pipe"],
  });
}
async function up(port, want = 200) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/health");
      if (r.status === want) return await r.json();
    } catch {}
    await sleep(200);
  }
  throw new Error("server not ready " + port);
}
const api = async (port, p, { body, tok, headers, method } = {}) => {
  const raw = body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body));
  const r = await fetch("http://127.0.0.1:" + port + p, {
    method: method || (raw !== undefined ? "POST" : "GET"),
    headers: { ...(raw !== undefined ? { "content-type": "application/json" } : {}), ...(tok ? { authorization: "Bearer " + tok } : {}), ...(headers || {}) },
    body: raw,
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, raw };
};
const sign = (raw, secret = base.WA_APP_SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

const refused = spawnSync(process.execPath, ["server.js"], {
  cwd: API, encoding: "utf8", timeout: 12000,
  env: { ...process.env, NODE_ENV: "production", PORT: "0", AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test", WA_APP_SECRET: "wa-secret-wa-secret-wa-secret", RESEND_API_KEY: "re_test", MAIL_FROM: "Relay <t@t.com>", MONGODB_URI: "mongodb://127.0.0.1:1/none", RELAY_ALLOW_MEMORY: "1" },
});
ok(refused.status === 1 && /Refusing to start/.test(refused.stderr || ""), "production refuses RELAY_ALLOW_MEMORY");
const deadDb = spawnSync(process.execPath, ["server.js"], {
  cwd: API, encoding: "utf8", timeout: 15000,
  env: { ...process.env, NODE_ENV: "production", PORT: "4599", AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test", WA_APP_SECRET: "wa-secret-wa-secret-wa-secret", RESEND_API_KEY: "re_test", MAIL_FROM: "Relay <t@t.com>", MONGODB_URI: "mongodb://127.0.0.1:1/none" },
});
ok(deadDb.status === 1 && /MongoDB connection failed|Refusing to start/.test(deadDb.stderr || ""), "production exits when MongoDB is down");

const onlyFb = spawnSync(process.execPath, ["server.js"], {
  cwd: API, encoding: "utf8", timeout: 8000,
  env: { ...process.env, NODE_ENV: "production", PORT: "0", AUTH_SECRET: "a".repeat(40), ENC_KEY: "b".repeat(40), PUBLIC_URL: "https://relay.test", RESEND_API_KEY: "re_test", MAIL_FROM: "Relay <t@t.com>", MONGODB_URI: mongoUri, FB_APP_SECRET: "x".repeat(20), WA_APP_SECRET: "" },
});
ok(onlyFb.status === 1 && /WA_APP_SECRET/.test(onlyFb.stderr || ""), "production requires WA_APP_SECRET itself");

let client;
try { client = new MongoClient(mongoUri); await client.connect(); await client.db().dropDatabase(); }
catch (e) { console.log("FAIL MongoDB is not available at " + mongoUri + " (" + e.message + ")"); process.exit(1); }

const s1 = boot(4511);
const s2 = boot(4512);
const h1 = await up(4511);
const h2 = await up(4512);
ok(h1.ok === true && h1.db === true && h2.db === true, "both production instances report a connected database");

const su = await api(4511, "/api/relay/auth/signup", { body: { email: "batch1@audit.test", password: "password123", company: "Batch Co" } });
ok(su.s === 201, "signup against MongoDB");
const tok = su.j.token;
const dup = await Promise.all([0, 1].map((i) => api(4511, "/api/relay/auth/signup", { body: { email: "race@audit.test", password: "password123", company: "Race " + i } })));
ok(dup.filter((x) => x.s === 201).length === 1 && dup.filter((x) => x.s === 409).length === 1, "parallel signup of one email creates one user");

const phones = Array.from({ length: 5 }, (_, i) => ({ name: "N" + i, phone: "91900000000" + i }));
await api(4511, "/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, contacts: phones } });
const conn = await api(4511, "/api/relay/wa/connect", { tok, body: { phoneId: "123456789012345", wabaId: "999888777", token: "EAA" + "y".repeat(30) } });
ok(conn.s === 200, "test WhatsApp account connected through the mock");

const unsigned = await api(4511, "/api/relay/webhook", { body: { entry: [] } });
ok(unsigned.s === 401, "unsigned WhatsApp webhook is rejected");
const badBody = JSON.stringify({ entry: [] });
ok((await api(4511, "/api/relay/webhook", { body: badBody, headers: { "x-hub-signature-256": "sha256=bad" } })).s === 401, "bad WhatsApp signature is rejected");
const good = JSON.stringify({ entry: [] });
ok((await api(4511, "/api/relay/webhook", { body: good, headers: { "x-hub-signature-256": sign(good) } })).s === 200, "valid WhatsApp signature is accepted");
ok((await api(4511, "/api/pulse/webhook", { body: good, headers: { "x-hub-signature-256": sign(good) } })).s === 200, "legacy /api/pulse webhook alias still works");
const broken = JSON.stringify({ entry: "nope" });
const brokenRes = await api(4511, "/api/relay/webhook", { body: broken, headers: { "x-hub-signature-256": sign(broken) } });
ok(brokenRes.s === 500, "invalid payload is stored and not acknowledged as success");
const brokenCount = await client.db().collection("webhook_inbox").countDocuments({ source: "whatsapp" });
ok(brokenCount >= 2, "failed webhook remains in the inbox (" + brokenCount + " rows)");

await api(4511, "/api/relay/rules", { method: "PUT", tok, body: { rules: [{ keyword: "hello", reply: "auto" }] } });
const inbound = (id) => JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "123456789012345" }, messages: [{ from: "919000000000", id, timestamp: "1700000000", text: { body: "hello there" } }] } }] }] });
const a = inbound("wamid.SAME");
const b = inbound("wamid.SAME").replace("1700000000", "1700000001");
await api(4511, "/api/relay/webhook", { body: a, headers: { "x-hub-signature-256": sign(a) } });
await api(4511, "/api/relay/webhook", { body: a, headers: { "x-hub-signature-256": sign(a) } });
await api(4512, "/api/relay/webhook", { body: b, headers: { "x-hub-signature-256": sign(b) } });
const inbox = await api(4511, "/api/relay/inbox", { tok });
const ins = (inbox.j.messages || []).filter((m) => m.direction === "in" && m.text === "hello there");
const outs = (inbox.j.messages || []).filter((m) => m.direction === "out");
ok(ins.length === 1 && outs.length === 1, "duplicate inbound deliveries create one message and one auto-reply");

sends.length = 0;
const started = await api(4511, "/api/relay/campaigns", { tok, body: { name: "Race", templateName: "festive_offer", lang: "en", consent: true, varCols: ["name"] } });
ok(started.s === 201 && started.j.total === 5, "campaign queued 5 messages");
await sleep(8000);
ok(sends.length === 5, "two API processes made " + sends.length + " Graph sends for 5 messages");
const unknown = await client.db().collection("messages").countDocuments({ status: "unknown", campaignId: started.j.id });
ok(unknown === 0, "confirmed sends are not left unknown");

s1.kill(); s2.kill();
await sleep(300);
hang = true;
sends.length = 0;
const slowSrv = boot(4513, { WA_FETCH_TIMEOUT_MS: "400", TICK_MS: "300" });
await up(4513);
const one = await api(4513, "/api/relay/contacts/import", { tok, body: { source: "website_form", attest: true, contacts: [{ name: "Slow", phone: "919111111111" }] } });
ok(one.s === 200, "imported the timeout contact");
const slow = await api(4513, "/api/relay/campaigns", { tok, body: { name: "Timeout", templateName: "festive_offer", lang: "en", consent: true, varCols: ["name"] } });
await sleep(2500);
const callsAfter = sends.length;
await sleep(2000);
const row = slow.j?.id ? await client.db().collection("messages").find({ campaignId: slow.j.id, phone: "919111111111" }).toArray() : [];
ok(row[0]?.status === "unknown" && sends.length === callsAfter, "a timed-out send becomes unknown and is not retried (" + (row[0]?.status || "missing") + ", calls " + sends.length + ")");

slowSrv.kill();
await client.close();
mock.close();
console.log(fails ? "FAILS " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
