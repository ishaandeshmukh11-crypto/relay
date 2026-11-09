// Shared send-authorization for campaigns and API-key sends. Pure decisions plus small DB lookups.
import { col } from "./store.js";
import { PLANS, blockReason } from "./shield.js";
import * as wa from "./wa.js";
import { getAccount } from "./events.js";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };
const prod = () => process.env.NODE_ENV === "production";

export function subscriptionActive(org, now = Date.now()) {
  if (!org) return { ok: false, reason: "no_org", error: "Organization not found." };
  if (org.plan === "trial" && !org.paidUntil) return { ok: true, plan: "trial" };
  // Past-due stays sendable only while graceUntil is in the future (REL-25).
  if (org.subStatus === "past_due" || org.subStatus === "unpaid" || org.subStatus === "halted") {
    if (org.graceUntil && new Date(org.graceUntil).getTime() >= now) return { ok: true, plan: org.plan || "trial", grace: true };
    return { ok: false, reason: "subscription_expired", error: "Payment failed and the grace period has ended. Update billing to send messages." };
  }
  if (org.paidUntil && new Date(org.paidUntil).getTime() < now) {
    return { ok: false, reason: "subscription_expired", error: "Your subscription has ended. Renew to send messages." };
  }
  if (org.subStatus === "expired") return { ok: false, reason: "subscription_expired", error: "Your subscription has ended. Renew to send messages." };
  return { ok: true, plan: org.plan || "trial" };
}

export async function monthlyQuota(orgId, planId) {
  const plan = PLANS[planId] || PLANS.trial;
  const used = await col("messages").countDocuments({ orgId, sentAt: { $gte: monthStart() } });
  return { used, cap: plan.marketingPerMonth, left: Math.max(0, plan.marketingPerMonth - used) };
}

export async function resolveTemplate(orgId, name, lang = "en") {
  const acc = await getAccount(orgId);
  if (!acc) {
    if (prod()) return { ok: false, reason: "not_connected", error: "WhatsApp is not connected." };
    const demos = [...(await col("demo_templates").find({ orgId }).toArray())];
    const builtIn = [
      { name: "payment_reminder", status: "APPROVED", language: "en" },
      { name: "festive_offer", status: "APPROVED", language: "en" },
    ];
    const t = [...builtIn, ...demos].find((x) => x.name === name && (!lang || !x.language || x.language === lang || String(x.language).startsWith(lang)));
    if (!t) return { ok: false, reason: "template_missing", error: "Template not found." };
    if (t.status !== "APPROVED") return { ok: false, reason: "template_unapproved", error: "Only APPROVED templates can be sent." };
    return { ok: true, template: t, demo: true, account: null };
  }
  let list;
  try { list = await wa.listTemplates(acc); }
  catch (e) { return { ok: false, reason: "template_lookup_failed", error: "Could not load templates from WhatsApp: " + e.message }; }
  const t = (list.data || []).find((x) => x.name === name && (!lang || x.language === lang || String(x.language).startsWith(String(lang).split("_")[0])));
  if (!t) return { ok: false, reason: "template_missing", error: "Template not found on this WhatsApp account." };
  if (String(t.status).toUpperCase() !== "APPROVED") return { ok: false, reason: "template_unapproved", error: "Only APPROVED templates can be sent. Current status: " + t.status };
  return { ok: true, template: t, demo: false, account: acc };
}

/**
 * Authorize one outbound template send.
 * @param {{ org, contact, templateName, lang?, skipFrequency?, count? }} args
 */
export async function authorizeSend({ org, contact, templateName, lang = "en", skipFrequency = false, count = 1 }) {
  if (!org || !contact) return { ok: false, status: 400, reason: "missing", error: "Missing organization or contact." };
  if (contact.orgId && contact.orgId !== org._id) return { ok: false, status: 403, reason: "wrong_org", error: "Contact does not belong to this organization." };

  const sub = subscriptionActive(org);
  if (!sub.ok) return { ok: false, status: 402, reason: sub.reason, error: sub.error };

  const why = blockReason(skipFrequency ? { ...contact, mkt: [] } : contact);
  if (why) return { ok: false, status: 403, reason: why, error: "Not sent: " + why };

  const q = await monthlyQuota(org._id, org.plan);
  if (q.left < count) return { ok: false, status: 402, reason: "quota", error: `Monthly message quota reached (${q.used}/${q.cap}). Upgrade or wait for next month.` };

  const tpl = await resolveTemplate(org._id, templateName, lang);
  if (!tpl.ok) return { ok: false, status: tpl.reason === "not_connected" ? 503 : 400, reason: tpl.reason, error: tpl.error };

  return { ok: true, account: tpl.account, demo: tpl.demo, quota: q, template: tpl.template };
}

export async function pauseExpiredCampaigns(now = Date.now()) {
  const running = await col("campaigns").find({ status: "running" }).toArray();
  let n = 0;
  for (const c of running) {
    const o = await col("orgs").findOne({ _id: c.orgId });
    const sub = subscriptionActive(o, now);
    if (!sub.ok) {
      await col("campaigns").updateOne({ _id: c._id }, { $set: { status: "paused", pauseReason: sub.error } });
      n++;
    }
  }
  return n;
}
