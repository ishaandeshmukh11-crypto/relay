// Everything that happens AFTER a message leaves: delivery status, customer replies, STOP, auto-replies, quality updates.
import { hooks } from "./hooks.js";
import { col, id, isDupKey } from "./store.js";
import { isOptOut, intentOf } from "./shield.js";
import { dec } from "./auth.js";
import * as wa from "./wa.js";

const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };
export async function getAccount(orgId) { const a = await col("wa_accounts").findOne({ orgId }); return a ? { ...a, token: dec(a.token) } : null; }

export async function refreshAccount(orgId) {
  const a = await getAccount(orgId); if (!a) return null;
  const p = await wa.getPhone(a);
  await col("wa_accounts").updateOne({ orgId }, { $set: { quality: p.quality_rating || "UNKNOWN", tier: p.messaging_limit_tier || a.tier || "TIER_250", number: p.display_phone_number, verifiedName: p.verified_name, checkedAt: new Date().toISOString() } });
  return getAccount(orgId);
}

export async function handleStatus({ wamid, status, ts, errors }) {
  const m = await col("messages").findOne({ wamid }); if (!m) return;
  const at = ts || new Date().toISOString();
  if (status === "failed") {
    const e = errors?.[0];
    return void (await col("messages").updateOne({ _id: m._id }, { $set: { status: "failed", errorCode: e?.code, error: e?.title || e?.message || "Failed", errorAt: at } }));
  }
  if ((RANK[status] ?? -1) <= (RANK[m.status] ?? 0)) return;
  await col("messages").updateOne({ _id: m._id }, { $set: { status, [status + "At"]: at } });
  if (status === "read") await col("contacts").updateOne({ _id: m.contactId }, { $set: { lastReadAt: at, unreadStreak: 0 } });
}

const personalise = (t, c) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k === "name" ? c?.name : c?.fields?.[k]) ?? "");
export async function applyWhatsAppWebhook(body) {
  if (!body || !Array.isArray(body.entry)) throw new Error("Invalid webhook payload");
  for (const ch of body.entry.flatMap((e) => e.changes || [])) {
    const v = ch.value || {}, acc = await col("wa_accounts").findOne({ phoneId: v.metadata?.phone_number_id });
    if (ch.field === "phone_number_quality_update") { const a = await col("wa_accounts").findOne({ number: v.display_phone_number }); if (a) await refreshAccount(a.orgId).catch(() => {}); continue; }
    if (!acc) continue;
    for (const s of v.statuses || []) await handleStatus({ wamid: s.id, status: s.status, ts: s.timestamp ? new Date(+s.timestamp * 1000).toISOString() : new Date().toISOString(), errors: s.errors });
    for (const m of v.messages || []) await handleInbound(acc.orgId, { metaId: m.id, from: m.from, text: m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "", ts: m.timestamp ? new Date(+m.timestamp * 1000).toISOString() : new Date().toISOString() });
  }
  return "processed";
}

export async function handleInbound(orgId, { from, text, ts, metaId }) {
  const at = ts || new Date().toISOString();
  if (metaId) {
    try { await col("wa_inbound").insertOne({ _id: id(), orgId, metaId, at }); }
    catch (e) { if (isDupKey(e)) return "duplicate"; throw e; }
  }
  let c = await col("contacts").findOne({ orgId, phone: from });
  if (!c) { // someone who messages us first has opened the conversation themselves
    c = { _id: id(), orgId, phone: from, name: "", fields: {}, optIn: { source: "inbound_message", at, proof: "Customer messaged first" }, createdAt: at };
    await col("contacts").insertOne(c);
  }
  await col("inbox").insertOne({ _id: id(), orgId, phone: from, name: c.name, direction: "in", text, at });
  const intent = isOptOut(text) ? "optout" : intentOf(text);
  await col("contacts").updateOne({ _id: c._id }, { $set: { lastReplyAt: at, unreadStreak: 0, lead: { intent, text: String(text).slice(0, 200), at } } });
  const last = (await col("messages").find({ orgId, phone: from }).sort({ createdAt: -1 }).limit(1).toArray())[0];
  if (last) await col("messages").updateOne({ _id: last._id }, { $set: { replied: true, repliedAt: at, replyText: text } });
  const acc = await getAccount(orgId);
  const say = async (t) => { if (acc) await wa.sendText(acc, from, t); await col("inbox").insertOne({ _id: id(), orgId, phone: from, name: c.name, direction: "out", text: t, at: new Date().toISOString(), auto: true }); };
  if (isOptOut(text)) {
    await col("contacts").updateOne({ _id: c._id }, { $set: { optedOut: true, optedOutAt: at } });
    await say("You have been unsubscribed and will not receive more messages from us.");
    return "optout";
  }
  const rules = (await col("rules").findOne({ orgId }))?.rules || [];
  const hit = rules.find((r) => r.keyword && String(text).toLowerCase().includes(r.keyword.toLowerCase()));
  if (hit) { await say(personalise(hit.reply, c)); return "auto_reply"; }
  if (hooks.inbound) { const h = await hooks.inbound({ orgId, channel: "whatsapp", senderId: from, name: c.name, text }).catch(() => null); if (h?.reply) { await say(h.reply); return "ai_reply"; } }
  return "needs_human";
}
