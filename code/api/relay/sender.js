// Campaign sender. A message is claimed in the database before it is sent.
// A timeout after the request starts becomes "unknown" and is not retried.
import { col, id } from "./store.js";
import { blockReason, tierLimit, guard } from "./shield.js";
import * as wa from "./wa.js";
import { getAccount, refreshAccount, handleStatus, handleInbound } from "./events.js";
import { drainInbox } from "./inbox.js";
import { pauseExpiredCampaigns, subscriptionActive } from "./policy.js";
import { enforceGraceExpirations } from "./billing.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = new Set();
const CANARY_WAIT = () => +(process.env.CANARY_WAIT_MS ?? 120000);
const RATE = () => +(process.env.RELAY_RATE ?? process.env.PULSE_RATE ?? 20);
const iso = () => new Date().toISOString();
const plus = (ms) => new Date(Date.now() + ms).toISOString();
const prod = () => process.env.NODE_ENV === "production";

export function startScheduler() {
  const t = setInterval(() => tick().catch((e) => console.error("[relay] tick", e.message)), +(process.env.TICK_MS ?? 3000));
  t.unref?.();
  return t;
}

async function dispatchInbox(row) {
  if (row.source === "whatsapp") {
    const { applyWhatsAppWebhook } = await import("./events.js");
    return applyWhatsAppWebhook(row.body);
  }
  if (row.source === "social") {
    const { applySocialWebhook } = await import("./social.js");
    return applySocialWebhook(row.body);
  }
  if (row.source === "razorpay") {
    const { applyWebhook } = await import("./billing.js");
    return applyWebhook(row.body);
  }
  if (row.source === "stripe") {
    const { applyStripeEvent } = await import("./billing.js");
    return applyStripeEvent(row.body);
  }
  return "ignored";
}

async function reclaim() {
  const now = iso();
  await col("messages").updateMany({ status: "processing", claimUntil: { $lt: now } }, { $set: { status: "queued", claimId: null, claimUntil: null } });
  await col("messages").updateMany({ status: "sending", claimUntil: { $lt: now } }, { $set: { status: "unknown", error: "Send outcome unknown after a timeout or crash. Not retried.", errorCode: "unknown", errorAt: now, claimId: null } });
}

export async function tick() {
  await reclaim();
  await drainInbox(dispatchInbox);
  await enforceGraceExpirations().catch(() => {});
  await pauseExpiredCampaigns();
  for (const c of await col("campaigns").find({ status: "running" }).toArray()) {
    if (busy.has(c._id)) continue;
    busy.add(c._id);
    run(c).catch((e) => console.error("[relay] campaign", c._id, e.message)).finally(() => busy.delete(c._id));
  }
}
const setC = (c, s) => col("campaigns").updateOne({ _id: c._id }, { $set: s });

function simulate(orgId, wamid, phone) {
  if (prod()) return;
  const later = (ms, fn) => setTimeout(fn, ms * (process.env.DEMO_FAST ? 0.05 : 1)).unref?.();
  later(400 + Math.random() * 1000, () => handleStatus({ wamid, status: "delivered" }));
  if (Math.random() < 0.8) later(1500 + Math.random() * 2500, () => handleStatus({ wamid, status: "read" }));
  if (Math.random() < 0.25) later(3500 + Math.random() * 3000, () => handleInbound(orgId, { from: phone, text: ["YES", "PRICE", "STOP", "Thanks", "CALL"][Math.floor(Math.random() * 5)] }));
}

async function stats(c) {
  const ms = await col("messages").find({ campaignId: c._id }).toArray();
  const recent = Date.now() - 2 * 36e5;
  const inflight = (m) => m.status === "processing" || m.status === "sending";
  return {
    sent: ms.filter((m) => m.sentAt).length,
    failed: ms.filter((m) => m.status === "failed").length,
    unknown: ms.filter((m) => m.status === "unknown").length,
    spamErrors: ms.filter((m) => m.errorCode === 131048 && new Date(m.errorAt || 0).getTime() > recent).length,
    queued: ms.filter((m) => m.status === "queued").length,
    inflight: ms.filter(inflight).length,
  };
}

async function own(m, claimId, from, to, extra = {}) {
  return col("messages").findOneAndUpdate(
    { _id: m._id, claimId, status: from },
    { $set: { status: to, claimUntil: plus(to === "sending" ? 90_000 : 30_000), ...extra } },
  );
}

async function sendOne(c, acc, m) {
  const claimId = id();
  const claimed = await col("messages").findOneAndUpdate(
    { _id: m._id, status: "queued" },
    { $set: { status: "processing", claimId, claimUntil: plus(30_000) } },
  );
  if (!claimed) return;
  const contact = await col("contacts").findOne({ _id: m.contactId });
  const why = contact && blockReason(contact, Date.now());
  if (!contact || why) {
    await own(m, claimId, "processing", "skipped", { error: why || "contact removed" });
    return;
  }
  const vars = (c.varCols || []).map((k) => (k === "name" ? contact.name : contact.fields?.[k] ?? contact[k]) ?? "");
  if (vars.some((v) => String(v).trim() === "")) {
    await own(m, claimId, "processing", "failed", { error: "A template variable was empty for this contact", errorCode: "missing_var", errorAt: iso() });
    return;
  }
  if (!acc && prod()) {
    await own(m, claimId, "processing", "failed", { error: "WhatsApp is not connected", errorCode: "not_connected", errorAt: iso() });
    return "stop";
  }
  const sending = await own(m, claimId, "processing", "sending");
  if (!sending) return;
  let wamid;
  if (!acc) wamid = "demo." + id();
  else {
    try {
      wamid = (await wa.sendTemplate(acc, contact.phone, { name: c.templateName, lang: (c.perContactLang && (contact.fields?.lang || contact.fields?.language)) || c.lang, vars })).messages?.[0]?.id;
    } catch (e) {
      if (e.uncertain) {
        await col("messages").updateOne({ _id: m._id, claimId, status: "sending" }, { $set: { status: "unknown", error: "WhatsApp did not confirm this send. It was not retried.", errorCode: e.code || "unknown", errorAt: iso(), claimUntil: null } });
        return "stop";
      }
      if (e.code === 130429) {
        await col("messages").updateOne({ _id: m._id, claimId, status: "sending" }, { $set: { status: "queued", claimId: null, claimUntil: null } });
        return "stop";
      }
      if (e.code === 190) {
        await col("messages").updateOne({ _id: m._id, claimId }, { $set: { status: "queued", claimId: null, claimUntil: null } });
        await setC(c, { status: "paused", pauseReason: "WhatsApp access token is invalid or expired. Reconnect WhatsApp." });
        return "stop";
      }
      await col("messages").updateOne({ _id: m._id, claimId, status: "sending" }, { $set: { status: "failed", errorCode: e.code ?? "error", error: e.code === 131049 ? "WhatsApp held this message to protect the customer (marketing frequency limit)" : e.message, errorAt: iso(), claimUntil: null } });
      if (e.code === 131048) {
        await setC(c, { status: "paused", pauseReason: "WhatsApp reported a spam-rate limit. Paused to protect your number." });
        return "stop";
      }
      return;
    }
  }
  if (!wamid) {
    await col("messages").updateOne({ _id: m._id, claimId, status: "sending" }, { $set: { status: "unknown", error: "WhatsApp accepted the call without a message id. Not retried.", errorCode: "missing_wamid", errorAt: iso(), claimUntil: null } });
    return "stop";
  }
  const now = iso();
  const saved = await col("messages").updateOne({ _id: m._id, claimId, status: "sending" }, { $set: { status: "sent", wamid, sentAt: now, claimUntil: null } });
  if (!saved?.matchedCount && saved?.matchedCount !== undefined) return;
  const week = (contact.mkt || []).filter((t) => Date.now() - new Date(t).getTime() < 7 * 864e5);
  await col("contacts").updateOne({ _id: contact._id }, { $set: { mkt: [...week, now] } });
  if (!acc) simulate(c.orgId, wamid, contact.phone);
}

async function run(c) {
  const org = await col("orgs").findOne({ _id: c.orgId });
  const sub = subscriptionActive(org);
  if (!sub.ok) return setC(c, { status: "paused", pauseReason: sub.error });
  let acc = await getAccount(c.orgId);
  if (acc && Date.now() - new Date(acc.checkedAt || 0) > 5 * 60e3) acc = (await refreshAccount(c.orgId).catch(() => null)) || acc;
  if (!acc && prod()) return setC(c, { status: "paused", pauseReason: "WhatsApp is not connected." });
  const quality = acc ? acc.quality : "GREEN";
  const st = await stats(c);
  const g = guard({ ...st, quality });
  if (g.action === "pause") return setC(c, { status: "paused", pauseReason: g.why });
  if (!st.queued && !st.inflight) {
    const ms = await col("messages").find({ campaignId: c._id, status: "delivered" }).toArray();
    for (const m of ms) { const k = await col("contacts").findOne({ _id: m.contactId }); if (k) await col("contacts").updateOne({ _id: k._id }, { $set: { unreadStreak: (k.unreadStreak || 0) + 1 } }); }
    return setC(c, { status: "done", finishedAt: iso(), stage: "done", ...(st.unknown ? { note: st.unknown + " messages have an unknown send result and were not retried." } : {}) });
  }
  if (st.inflight && !st.queued) return;
  if (c.stage === "canary_wait") {
    if (Date.now() - new Date(c.canaryAt).getTime() < CANARY_WAIT()) return;
    await setC(c, { stage: "main", note: g.action === "slow" ? g.why : "" });
    c = { ...c, stage: "main" };
  }
  const pending = await col("messages").find({ campaignId: c._id, status: "queued" }).sort({ score: -1 }).toArray();
  let batch;
  if (c.stage === "canary") batch = pending.slice(0, c.canary);
  else {
    const recent = await col("messages").find({ orgId: c.orgId, sentAt: { $gte: new Date(Date.now() - 864e5).toISOString() } }).toArray();
    const capacity = (acc ? tierLimit(acc.tier) : 1000) - new Set(recent.map((m) => m.phone)).size;
    if (capacity <= 0) return setC(c, { note: "Waiting for WhatsApp's daily limit to reset. Remaining contacts go out automatically." });
    batch = pending.slice(0, capacity);
    await setC(c, { note: g.action === "slow" ? "Sending slowly: " + g.why : "" });
  }
  const gap = g.action === "slow" ? 1000 : 1000 / RATE();
  let n = 0;
  for (const m of batch) {
    if (n++ % 10 === 0) { const cur = await col("campaigns").findOne({ _id: c._id }); if (!cur || cur.status !== "running") return; }
    if ((await sendOne(c, acc, m)) === "stop") break;
    await sleep(gap);
  }
  const cur = await col("campaigns").findOne({ _id: c._id });
  if (cur?.status === "running" && c.stage === "canary") await setC(c, { stage: "canary_wait", canaryAt: iso() });
}
