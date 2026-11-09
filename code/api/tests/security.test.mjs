// Security/correctness regression checks for audit fixes (memory store + pure helpers).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { enableMemory, col, id } from "../relay/store.js";
import { timingSafeEqualStr, checkPw, hashPw, sign, requireAuth } from "../relay/auth.js";
import { assertProviderBase } from "../relay/providers.js";
import { persistWebhook, claimWebhook, completeWebhook, failWebhook } from "../relay/inbox.js";
import { applyStripeEvent, verifyStripeWebhook } from "../relay/billing.js";
import { parseCorsOrigins } from "../relay/cors.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

enableMemory();

assert.equal(timingSafeEqualStr("secret-key-abc", "secret-key-abc"), true);
assert.equal(timingSafeEqualStr("secret-key-abc", "secret-key-abd"), false);
assert.equal(timingSafeEqualStr("short", "longer-value"), false);
assert.equal(checkPw("password123", hashPw("password123")), true);
assert.equal(checkPw("password123", "not-a-hash"), false);
assert.equal(checkPw("password123", ""), false);
console.log("PASS auth timing-safe + checkPw harden");

const prev = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
delete process.env.RELAY_ALLOW_LOCAL_PROVIDERS;
assert.throws(() => assertProviderBase("graph", "http://evil.example/ssrf", "https://graph.facebook.com/v21.0"), /untrusted/);
assert.throws(() => assertProviderBase("stripe", "https://evil.example/v1", "https://api.stripe.com/v1"), /untrusted/);
assert.throws(() => assertProviderBase("graph", "http://127.0.0.1:4919", "https://graph.facebook.com/v21.0"), /untrusted/);
assert.equal(assertProviderBase("graph", "https://graph.facebook.com/v21.0", "https://graph.facebook.com/v21.0"), "https://graph.facebook.com/v21.0");
process.env.RELAY_ALLOW_LOCAL_PROVIDERS = "1";
assert.equal(assertProviderBase("graph", "http://127.0.0.1:4919", "https://graph.facebook.com/v21.0"), "http://127.0.0.1:4919");
delete process.env.RELAY_ALLOW_LOCAL_PROVIDERS;
process.env.NODE_ENV = "development";
assert.equal(assertProviderBase("graph", "http://127.0.0.1:4919", "https://graph.facebook.com/v21.0"), "http://127.0.0.1:4919");
process.env.NODE_ENV = prev;
console.log("PASS provider base allowlist");

assert.deepEqual(parseCorsOrigins("https://a.example, https://b.example ,http://localhost:3000"), [
  "https://a.example",
  "https://b.example",
  "http://localhost:3000",
]);
assert.deepEqual(parseCorsOrigins("  "), ["http://localhost:3000"]);
console.log("PASS CORS whitespace normalization");

const orgId = id();
const uid = id();
await col("orgs").insertOne({ _id: orgId, name: "Sec Co", plan: "trial", pendingPlan: "starter", createdAt: new Date().toISOString() });
await col("users").insertOne({ _id: uid, orgId, email: "owner@sec.test", pw: hashPw("password123"), tokenVersion: 2, verified: true, createdAt: new Date().toISOString() });
async function runAuth(token) {
  const req = { headers: { authorization: "Bearer " + token }, user: null };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ status: this.statusCode, body: b, user: req.user }); return this; },
    };
    requireAuth(req, res, (err) => resolve({ status: res.statusCode, err, user: req.user }));
  });
}
const spoof = await runAuth(sign({ uid, orgId: "forged-org", email: "attacker@evil.test", tv: 2 }));
assert.equal(spoof.status, 200);
assert.equal(spoof.user.orgId, orgId);
assert.equal(spoof.user.email, "owner@sec.test");
assert.equal(spoof.user.tv, 2);
const badTv = await runAuth(sign({ uid, orgId, email: "owner@sec.test", tv: 0 }));
assert.equal(badTv.status, 401);
console.log("PASS DB-backed session identity");

const unknown = await applyStripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_x", customer: "cus_x", subscription: "sub_x", metadata: {}, client_reference_id: "missing" } } });
assert.equal(unknown, "unknown_org");
const okCheckout = await applyStripeEvent({
  type: "checkout.session.completed",
  data: { object: { id: "cs_ok", customer: "cus_ok", subscription: "sub_ok", metadata: { plan: "growth" }, client_reference_id: orgId } },
});
assert.equal(okCheckout, "checkout_completed");
const org = await col("orgs").findOne({ _id: orgId });
assert.equal(org.stripeSubId, "sub_ok");
assert.equal(org.pendingPlan, "growth");
// Idempotent re-apply must not invent a second org or throw
const againCheckout = await applyStripeEvent({
  type: "checkout.session.completed",
  data: { object: { id: "cs_ok", customer: "cus_ok", subscription: "sub_ok", metadata: { plan: "growth" }, client_reference_id: orgId } },
});
assert.equal(againCheckout, "checkout_completed");
console.log("PASS Stripe checkout.session.completed null-org guard + idempotent re-apply");

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
const raw = Buffer.from(JSON.stringify({ id: "evt_1" }));
const t = String(Math.floor(Date.now() / 1000));
const v1 = crypto.createHmac("sha256", "whsec_test").update(t + "." + raw).digest("hex");
assert.equal(verifyStripeWebhook(raw, `t=${t},v1=${v1}`), true);
assert.equal(verifyStripeWebhook(raw, `t=${t},v1=dead,v1=${v1}`), true);
assert.equal(verifyStripeWebhook(raw, `t=${t},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`), false);
assert.equal(verifyStripeWebhook(raw, `t=${Number(t) - 400},v1=${v1}`), false);
console.log("PASS Stripe multi-v1 signature verify + skew reject");

const body = Buffer.from(JSON.stringify({ entry: [{ id: "race" }] }));
const first = await persistWebhook("whatsapp", body, JSON.parse(body.toString()));
assert.equal(first.duplicate, false);
const c1 = await claimWebhook(first.key);
const c2 = await claimWebhook(first.key);
assert.ok(c1, "first claim wins");
assert.equal(c2, null, "second claim blocked while processing");
await completeWebhook(first.key, "processed");
const again = await persistWebhook("whatsapp", body, JSON.parse(body.toString()));
assert.equal(again.duplicate, true);
assert.equal(again.row.status, "done");
const cDone = await claimWebhook(first.key);
assert.equal(cDone, null, "done events are not reclaimable");
console.log("PASS webhook claim prevents concurrent double-process");

// Failure → pending retry (idempotent path); attempts counted once per claim
const failBody = Buffer.from(JSON.stringify({ entry: [{ id: "fail-once" }] }));
const failed = await persistWebhook("stripe", failBody, JSON.parse(failBody.toString()));
const fc = await claimWebhook(failed.key);
assert.equal(fc.attempts, 1);
await failWebhook(failed.key, new Error("provider timeout"));
const afterFail = await col("webhook_inbox").findOne({ key: failed.key });
assert.equal(afterFail.status, "pending");
assert.equal(afterFail.attempts, 1, "failWebhook must not double-count attempts");
const retryClaim = await claimWebhook(failed.key);
assert.ok(retryClaim);
assert.equal(retryClaim.attempts, 2);
await completeWebhook(failed.key, "activated");
assert.equal((await col("webhook_inbox").findOne({ key: failed.key })).status, "done");
console.log("PASS webhook fail → pending → retry → done");

// Stale processing claim recovery after crash
const staleBody = Buffer.from(JSON.stringify({ entry: [{ id: "stale" }] }));
const stale = await persistWebhook("razorpay", staleBody, JSON.parse(staleBody.toString()));
const sc = await claimWebhook(stale.key);
assert.ok(sc);
await col("webhook_inbox").updateOne({ key: stale.key }, { $set: { claimUntil: new Date(Date.now() - 1000).toISOString() } });
const recovered = await claimWebhook(stale.key);
assert.ok(recovered, "stale processing claim must be reclaimable");
await completeWebhook(stale.key, "recovered");
console.log("PASS stale processing claim recovery");

// Dead after 5 claims: not reclaimable as pending
const poisonBody = Buffer.from(JSON.stringify({ entry: [{ id: "poison" }] }));
const poison = await persistWebhook("whatsapp", poisonBody, JSON.parse(poisonBody.toString()));
for (let i = 0; i < 5; i++) {
  const c = await claimWebhook(poison.key);
  assert.ok(c, "claim " + (i + 1));
  await failWebhook(poison.key, new Error("boom"));
}
const dead = await col("webhook_inbox").findOne({ key: poison.key });
assert.equal(dead.status, "dead");
assert.equal(await claimWebhook(poison.key), null);
console.log("PASS webhook dead after 5 failed claims");

// Rate-limit architecture: no dead global /api limiter after mounts; router owns limits
const serverSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");
const routesSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../relay/routes.js"), "utf8");
assert.doesNotMatch(serverSrc, /app\.use\("\/api",\s*rateLimit/);
assert.match(serverSrc, /Rate limits live on the Relay router/);
assert.match(routesSrc, /const apiLimit = rateLimit/);
assert.match(routesSrc, /const strict = rateLimit/);
assert.match(routesSrc, /r\.use\(apiLimit\)/);
const webhookIdx = routesSrc.indexOf('r.post("/webhook"');
const apiLimitIdx = routesSrc.indexOf("r.use(apiLimit)");
assert.ok(webhookIdx > 0 && apiLimitIdx > webhookIdx, "webhooks registered before apiLimit");
console.log("PASS rate-limit ordering (router-level; webhooks excluded from apiLimit)");

console.log("ALL PASS security.test.mjs");
