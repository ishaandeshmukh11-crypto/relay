// Instagram + Facebook automation, included in the same Relay subscription.
// Only what Meta allows: reply to comments, send ONE private reply per comment (comment-to-DM), and answer people who message you (24h window).
// No cold/bulk DMs to people who never interacted: Meta does not permit it, so Relay does not offer it.
import express from "express";
import { z } from "zod";
import { col, id } from "./store.js";
import { metaSignatureOk, persistWebhook, completeWebhook, failWebhook, claimWebhook } from "./inbox.js";
import { requireAuth, enc, dec } from "./auth.js";
import { hooks } from "./hooks.js";
import { PLANS, isOptOut, intentOf } from "./shield.js";
import { graphBase } from "./providers.js";

const base = () => graphBase();
const iso = () => new Date().toISOString();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const DAY = 864e5;
async function graph(path, { method = "GET", token, body } = {}) {
  const r = await fetch(base() + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Graph API ${r.status}`), { code: j.error?.code, status: r.status });
  return j;
}
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };
const fill = (t, name) => String(t || "").replace(/\{\{\s*name\s*\}\}/gi, (name || "there").split(/\s+/)[0]);
const PHONE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/, EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// ---------- engine ----------
async function quotaLeft(orgId) {
  const o = await col("orgs").findOne({ _id: orgId }), cap = (PLANS[o?.plan] || PLANS.trial).socialPerMonth;
  if (o?.paidUntil && new Date(o.paidUntil) < new Date()) return 0;
  return Math.max(0, cap - await col("social_msgs").countDocuments({ orgId, dir: "out", auto: true, ts: { $gte: monthStart() } }));
}
async function thread(orgId, channel, senderId, username) {
  let t = await col("social_threads").findOne({ orgId, channel, senderId });
  if (!t) { t = { _id: id(), orgId, channel, senderId, username: username || senderId, optedOut: false, createdAt: iso() }; await col("social_threads").insertOne(t); }
  else if (username && t.username !== username) await col("social_threads").updateOne({ _id: t._id }, { $set: { username } });
  return t;
}
async function record(orgId, t, dir, text, extra = {}) { await col("social_msgs").insertOne({ _id: id(), orgId, threadId: t._id, channel: t.channel, dir, text, ts: iso(), ...extra }); }

async function send(acc, ev, text, { demo }) {
  // returns {ok, error}
  if (demo || !acc) return { ok: true };
  const token = dec(acc.token), owner = ev.channel === "instagram" ? acc.igId : acc.pageId;
  try {
    await graph(`/${owner}/messages`, { method: "POST", token, body: { recipient: ev.commentId && ev.firstTouch ? { comment_id: ev.commentId } : { id: ev.from.id }, message: { text }, ...(ev.commentId ? {} : { messaging_type: "RESPONSE" }) } });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message, code: e.code }; }
}
async function publicReply(acc, ev, text, { demo }) {
  if (demo || !acc || !text) return;
  const token = dec(acc.token);
  try { await graph(ev.channel === "instagram" ? `/${ev.commentId}/replies` : `/${ev.commentId}/comments`, { method: "POST", token, body: { message: text } }); } catch {}
}

export async function processEvent(orgId, acc, ev, { demo = false } = {}) {
  const out = { handled: false, reason: "no_rule" };
  const own = acc && (ev.from.id === acc.pageId || ev.from.id === acc.igId);
  if (own) return { handled: false, reason: "own_message" };
  const autos = await col("autos").find({ orgId, enabled: true }).toArray();
  const t = await thread(orgId, ev.channel, ev.from.id, ev.from.username);
  const textL = String(ev.text || "").toLowerCase();

  if (ev.kind === "comment") {
    if (await col("social_log").findOne({ orgId, key: "c:" + ev.commentId })) return { handled: false, reason: "duplicate" };
    await col("social_log").insertOne({ _id: id(), orgId, key: "c:" + ev.commentId, ts: iso() });
    if (t.optedOut) return { handled: false, reason: "opted_out" };
    const a = autos.find((x) => x.type === "comment_to_dm" && (x.channel === "both" || x.channel === ev.channel) && (!x.postId || x.postId === ev.postId) && (!x.keywords?.length || x.keywords.some((k) => textL.includes(k.toLowerCase()))));
    if (!a) return out;
    if (await col("social_msgs").findOne({ orgId, threadId: t._id, autoId: a._id, dir: "out", ts: { $gte: new Date(Date.now() - DAY).toISOString() } })) return { handled: false, reason: "already_messaged_today" };
    if (!(await quotaLeft(orgId))) return { handled: false, reason: "plan_limit" };
    await col("social_threads").updateOne({ _id: t._id }, { $set: { lastInboundAt: iso() } }); // a comment lets us send one private reply (7 days)
    await record(orgId, t, "in", ev.text, { comment: true });
    const text = fill(a.reply, ev.from.username), r = await send(acc, { ...ev, firstTouch: true }, text, { demo });
    if (r.ok) { await record(orgId, t, "out", text, { auto: true, autoId: a._id, demo }); await publicReply(acc, ev, fill(a.publicReply, ev.from.username), { demo }); await col("autos").updateOne({ _id: a._id }, { $inc: { sent: 1 } }); }
    else await col("autos").updateOne({ _id: a._id }, { $inc: { failed: 1 }, $set: { lastError: r.error } });
    return { handled: r.ok, reason: r.ok ? "sent" : "error:" + r.error };
  }

  // direct message
  if (ev.mid && await col("social_log").findOne({ orgId, key: "m:" + ev.mid })) return { handled: false, reason: "duplicate" };
  if (ev.mid) await col("social_log").insertOne({ _id: id(), orgId, key: "m:" + ev.mid, ts: iso() });
  await col("social_threads").updateOne({ _id: t._id }, { $set: { lastInboundAt: iso(), intent: intentOf(ev.text) } });
  await record(orgId, t, "in", ev.text);
  const ph = ev.text.match(PHONE), em = ev.text.match(EMAIL);
  if (ph || em) await col("social_threads").updateOne({ _id: t._id }, { $set: { lead: { phone: ph?.[0] || t.lead?.phone || null, email: em?.[0] || t.lead?.email || null } } });
  if (isOptOut(ev.text)) {
    await col("social_threads").updateOne({ _id: t._id }, { $set: { optedOut: true } });
    const txt = "Done, you will not get automated messages from us. Message us anytime if you need help.";
    if ((await send(acc, ev, txt, { demo })).ok) await record(orgId, t, "out", txt, { auto: true, demo });
    return { handled: true, reason: "opt_out" };
  }
  if (t.optedOut) return { handled: false, reason: "opted_out" };
  const a = autos.find((x) => x.type === "dm_keyword" && (x.channel === "both" || x.channel === ev.channel) && x.keywords?.some((k) => textL.includes(k.toLowerCase())))
    || (!(await col("social_msgs").findOne({ orgId, threadId: t._id, dir: "out", auto: true, ts: { $gte: new Date(Date.now() - DAY).toISOString() } })) && autos.find((x) => x.type === "welcome" && (x.channel === "both" || x.channel === ev.channel)));
  if (!a) {
    const h = hooks.inbound && await hooks.inbound({ orgId, channel: ev.channel, senderId: ev.from.id, name: ev.from.username, text: ev.text }).catch(() => null);
    if (h?.reply) { const r = await send(acc, ev, h.reply, { demo }); if (r.ok) await record(orgId, t, "out", h.reply, { auto: true, demo }); return { handled: r.ok, reason: r.ok ? "ai_reply" : "error:" + r.error }; }
    return out;
  }
  if (!(await quotaLeft(orgId))) return { handled: false, reason: "plan_limit" };
  const text = fill(a.reply, ev.from.username), r = await send(acc, ev, text, { demo });
  if (r.ok) { await record(orgId, t, "out", text, { auto: true, autoId: a._id, demo }); await col("autos").updateOne({ _id: a._id }, { $inc: { sent: 1 } }); }
  return { handled: r.ok, reason: r.ok ? "sent" : "error:" + r.error };
}

// ---------- public webhook (called by Meta) ----------
export const socialPublic = express.Router();
export async function applySocialWebhook(body) {
  const channel = body?.object === "instagram" ? "instagram" : body?.object === "page" ? "facebook" : null;
  if (!channel) return "ignored";
  if (!Array.isArray(body.entry)) throw new Error("Invalid social webhook payload");
  for (const e of body.entry) {
    const acc = await col("social_accounts").findOne(channel === "instagram" ? { igId: e.id } : { pageId: e.id }); if (!acc) continue;
    for (const c of e.changes || []) {
      const v = c.value || {};
      if (channel === "instagram" && c.field === "comments") await processEvent(acc.orgId, acc, { kind: "comment", channel, commentId: v.id, postId: v.media?.id, from: { id: v.from?.id, username: v.from?.username }, text: v.text || "" });
      if (channel === "facebook" && c.field === "feed" && v.item === "comment" && v.verb === "add") await processEvent(acc.orgId, acc, { kind: "comment", channel, commentId: v.comment_id, postId: v.post_id, from: { id: v.from?.id, username: v.from?.name }, text: v.message || "" });
    }
    for (const m of e.messaging || []) {
      if (!m.message || m.message.is_echo || !m.sender?.id) continue;
      await processEvent(acc.orgId, acc, { kind: "dm", channel, mid: m.message.mid, from: { id: m.sender.id }, text: m.message.text || "" });
    }
  }
  return "processed";
}
socialPublic.get("/webhook", (q, s) => { const t = process.env.SOCIAL_VERIFY_TOKEN || process.env.WA_VERIFY_TOKEN; return q.query["hub.mode"] === "subscribe" && t && q.query["hub.verify_token"] === t ? s.send(q.query["hub.challenge"]) : s.sendStatus(403); });
socialPublic.post("/webhook", wrap(async (req, res) => {
  if (!metaSignatureOk(req.rawBody, req.headers["x-hub-signature-256"], process.env.FB_APP_SECRET || process.env.WA_APP_SECRET)) return res.sendStatus(401);
  let stored;
  try { stored = await persistWebhook("social", req.rawBody, req.body); }
  catch { return res.status(503).json({ error: "Webhook was not stored. Please retry." }); }
  if (stored.duplicate && stored.row?.status === "done") return res.sendStatus(200);
  if (stored.duplicate && stored.row?.status === "processing" && stored.row.claimUntil && stored.row.claimUntil > new Date().toISOString()) return res.sendStatus(200);
  const claimed = await claimWebhook(stored.key);
  if (!claimed) return res.sendStatus(200);
  try {
    await applySocialWebhook(req.body);
    await completeWebhook(stored.key, "processed");
    return res.sendStatus(200);
  } catch (e) {
    await failWebhook(stored.key, e);
    return res.status(500).json({ error: "Webhook stored but not processed. It will be retried." });
  }
}));

// ---------- logged-in API ----------
export const social = express.Router();
social.use(requireAuth);
const accOf = (orgId) => col("social_accounts").findOne({ orgId });
const AUTO = z.object({
  type: z.enum(["comment_to_dm", "dm_keyword", "welcome"]), channel: z.enum(["instagram", "facebook", "both"]).default("both"),
  name: z.string().trim().min(2).max(80), keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  postId: z.string().trim().max(60).optional().or(z.literal("")), reply: z.string().trim().min(2).max(1000), publicReply: z.string().trim().max(300).optional().or(z.literal("")), enabled: z.boolean().default(true),
});

social.get("/", wrap(async (req, res) => {
  const o = req.user.orgId, a = await accOf(o), plan = (PLANS[(await col("orgs").findOne({ _id: o })).plan] || PLANS.trial);
  res.json({
    connected: !!a, page: a ? { id: a.pageId, name: a.pageName, igId: a.igId || null, igUsername: a.igUsername || null } : null,
    autos: await col("autos").find({ orgId: o }).toArray(), quota: { used: await col("social_msgs").countDocuments({ orgId: o, dir: "out", auto: true, ts: { $gte: monthStart() } }), cap: plan.socialPerMonth },
    webhook: { callback: "/api/relay/social/webhook", fields: "Instagram: comments, messages · Page: feed, messages" },
  });
}));
social.post("/fb/pages", wrap(async (req, res) => {
  const { userToken } = z.object({ userToken: z.string().min(10) }).parse(req.body);
  const j = await graph("/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=50", { token: userToken }).catch((e) => { throw Object.assign(e, { status: 400 }); });
  res.json({ pages: (j.data || []).map((p) => ({ id: p.id, name: p.name, ig: p.instagram_business_account?.username || null })) });
}));
social.post("/connect", wrap(async (req, res) => {
  const b = z.object({ pageId: z.string().min(3), userToken: z.string().optional(), token: z.string().optional() }).refine((x) => x.userToken || x.token).parse(req.body);
  let token = b.token;
  if (!token) { const j = await graph("/me/accounts?fields=id,access_token&limit=50", { token: b.userToken }); token = j.data?.find((p) => p.id === b.pageId)?.access_token; if (!token) return res.status(400).json({ error: "That Page is not available for this Facebook login." }); }
  let info; try { info = await graph(`/${b.pageId}?fields=name,instagram_business_account{id,username}`, { token }); } catch (e) { return res.status(400).json({ error: "Could not read this Page: " + e.message }); }
  await graph(`/${b.pageId}/subscribed_apps`, { method: "POST", token, body: { subscribed_fields: ["messages", "messaging_postbacks", "feed"] } }).catch(() => {});
  await col("social_accounts").deleteMany({ orgId: req.user.orgId });
  await col("social_accounts").insertOne({ _id: id(), orgId: req.user.orgId, pageId: b.pageId, pageName: info.name, igId: info.instagram_business_account?.id || null, igUsername: info.instagram_business_account?.username || null, token: enc(token), connectedAt: iso() });
  res.json({ ok: true, page: info.name, instagram: info.instagram_business_account?.username || null });
}));
social.delete("/connect", wrap(async (req, res) => { await col("social_accounts").deleteMany({ orgId: req.user.orgId }); res.json({ ok: true }); }));

social.post("/autos", wrap(async (req, res) => {
  const b = AUTO.parse(req.body); if (b.type !== "welcome" && !b.keywords.length && b.type === "dm_keyword") return res.status(400).json({ error: "Add at least one keyword." });
  const d = { _id: id(), orgId: req.user.orgId, ...b, sent: 0, failed: 0, createdAt: iso() }; await col("autos").insertOne(d); res.status(201).json(d);
}));
social.put("/autos/:id", wrap(async (req, res) => { const b = AUTO.partial().parse(req.body); await col("autos").updateOne({ _id: req.params.id, orgId: req.user.orgId }, { $set: b }); res.json({ ok: true }); }));
social.post("/autos/:id/delete", wrap(async (req, res) => { await col("autos").deleteMany({ _id: req.params.id, orgId: req.user.orgId }); res.json({ ok: true }); }));

social.get("/inbox", wrap(async (req, res) => {
  const o = req.user.orgId, ts = await col("social_threads").find({ orgId: o }).sort({ lastInboundAt: -1 }).limit(60).toArray(), out = [];
  for (const t of ts) { const m = await col("social_msgs").find({ orgId: o, threadId: t._id }).sort({ ts: -1 }).limit(8).toArray(); out.push({ ...t, canReply: !t.optedOut && !!t.lastInboundAt && Date.now() - new Date(t.lastInboundAt) < DAY, messages: m.reverse() }); }
  res.json({ threads: out });
}));
social.post("/reply", wrap(async (req, res) => {
  const b = z.object({ threadId: z.string(), text: z.string().trim().min(1).max(1000) }).parse(req.body), o = req.user.orgId;
  const t = await col("social_threads").findOne({ _id: b.threadId, orgId: o }); if (!t) return res.status(404).json({ error: "Conversation not found" });
  if (t.optedOut) return res.status(400).json({ error: "This person asked to stop messages." });
  if (!t.lastInboundAt || Date.now() - new Date(t.lastInboundAt) > DAY) return res.status(400).json({ error: "Meta only allows replies within 24 hours of the person's last message." });
  const a = await accOf(o), r = await send(a, { channel: t.channel, from: { id: t.senderId } }, b.text, { demo: !a || t.demo });
  if (!r.ok) return res.status(502).json({ error: r.error }); await record(o, t, "out", b.text, { demo: !a }); res.json({ ok: true });
}));
// Try it without connecting: feeds a fake comment or DM through the real engine (nothing is sent to Meta).
social.post("/simulate", wrap(async (req, res) => {
  const b = z.object({ kind: z.enum(["comment", "dm"]), channel: z.enum(["instagram", "facebook"]).default("instagram"), text: z.string().max(500), username: z.string().max(60).default("demo_user") }).parse(req.body);
  const uid = "demo-" + b.username, ev = b.kind === "comment" ? { kind: "comment", channel: b.channel, commentId: "demo-" + id(), from: { id: uid, username: b.username }, text: b.text } : { kind: "dm", channel: b.channel, mid: "demo-" + id(), from: { id: uid, username: b.username }, text: b.text };
  res.json(await processEvent(req.user.orgId, null, ev, { demo: true }));
}));

// Used by Mira so the owner can reply from the inbox. Meta only allows this within 24 hours of the customer's last message.
export async function sendDM(orgId, channel, senderId, text) {
  const acc = await col("social_accounts").findOne({ orgId }); if (!acc) throw new Error("Instagram/Facebook is not connected.");
  const owner = channel === "instagram" ? acc.igId : acc.pageId;
  await graph(`/${owner}/messages`, { method: "POST", token: dec(acc.token), body: { recipient: { id: senderId }, message: { text }, messaging_type: "RESPONSE" } });
}
