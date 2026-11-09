// Billing providers: Stripe (USD) and Razorpay (INR). Plan amounts must match configured provider plans.
// USD list prices (customer guide): Starter $49 / 1,000 conversations, Growth $149 / 10,000, annual = 10 months billed.
// INR list prices remain explicitly configurable and unapproved until a final INR price list is confirmed.
import crypto from "node:crypto";
import { col } from "./store.js";
import { razorpayBase, stripeBase } from "./providers.js";

const RZP_BASE = () => razorpayBase();
const STRIPE_BASE = () => stripeBase();
const rzpAuth = () => "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
const stripeAuth = () => "Bearer " + process.env.STRIPE_SECRET_KEY;

export const USD_PRICES = {
  starter: { amount: 49, currency: "USD", conversations: 1000, annualMonthsCharged: 10 },
  growth: { amount: 149, currency: "USD", conversations: 10000, annualMonthsCharged: 10 },
};
// Unapproved display defaults for INR until business confirms the final list.
export const INR_PRICES = {
  starter: Number(process.env.PRICE_STARTER || 1999),
  growth: Number(process.env.PRICE_GROWTH || 4999),
  currency: "INR",
  approved: process.env.INR_PRICES_APPROVED === "1",
};

export const PRICES = {
  usd: USD_PRICES,
  inr: { starter: INR_PRICES.starter, growth: INR_PRICES.growth },
  inrApproved: INR_PRICES.approved,
  note: INR_PRICES.approved
    ? undefined
    : "INR amounts are configurable placeholders until the final INR price list is approved. Live INR checkout stays disabled unless INR_PRICES_APPROVED=1 and Razorpay plan ids are set.",
};

export const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const stripeConfigured = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
export const billingConfigured = () => razorpayConfigured() || stripeConfigured();

const rzpPlanId = (p) => process.env["RAZORPAY_PLAN_" + p.toUpperCase()];
const stripePriceId = (p, interval = "month") => process.env[`STRIPE_PRICE_${p.toUpperCase()}_${interval === "year" ? "YEAR" : "MONTH"}`];

export function preferredProvider(currency) {
  const c = String(currency || process.env.BILLING_CURRENCY || "USD").toUpperCase();
  if (c === "INR") return "razorpay";
  return "stripe";
}

export function checkoutAllowed(plan, { currency, interval = "month" } = {}) {
  const provider = preferredProvider(currency);
  if (provider === "stripe") {
    if (!stripeConfigured()) return { ok: false, error: "USD checkout requires Stripe keys and webhook secret." };
    if (!stripePriceId(plan, interval)) return { ok: false, error: `Missing STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEAR" : "MONTH"}.` };
    return { ok: true, provider, currency: "USD" };
  }
  if (!razorpayConfigured()) return { ok: false, error: "INR checkout requires Razorpay keys." };
  if (!INR_PRICES.approved) return { ok: false, error: "INR prices are not approved yet. Set INR_PRICES_APPROVED=1 only after the final INR price list is confirmed." };
  if (!rzpPlanId(plan)) return { ok: false, error: `Missing RAZORPAY_PLAN_${plan.toUpperCase()}.` };
  return { ok: true, provider, currency: "INR" };
}

async function cancelProviderSubscription(org, { immediate = false } = {}) {
  const results = [];
  if (org.stripeSubId && stripeConfigured()) {
    const r = await fetch(STRIPE_BASE() + `/subscriptions/${org.stripeSubId}${immediate ? "" : ""}`, {
      method: immediate ? "DELETE" : "POST",
      headers: { Authorization: stripeAuth(), "content-type": "application/x-www-form-urlencoded" },
      body: immediate ? undefined : new URLSearchParams({ cancel_at_period_end: "true" }).toString(),
    }).catch(() => null);
    results.push({ provider: "stripe", ok: !!r?.ok });
  }
  if (org.subId && razorpayConfigured()) {
    const r = await fetch(RZP_BASE() + `/subscriptions/${org.subId}/cancel`, {
      method: "POST",
      headers: { Authorization: rzpAuth(), "content-type": "application/json" },
      body: JSON.stringify({ cancel_at_cycle_end: immediate ? 0 : 1 }),
    }).catch(() => null);
    results.push({ provider: "razorpay", ok: !!r?.ok });
  }
  return results;
}

export async function createSubscription(org, plan, email, { currency, interval = "month" } = {}) {
  const gate = checkoutAllowed(plan, { currency, interval });
  if (!gate.ok) return { configured: false, error: gate.error };

  // REL-24: cancel any previous active subscription before opening a new checkout.
  if (org.subId || org.stripeSubId) {
    await cancelProviderSubscription(org, { immediate: false });
    await col("orgs").updateOne({ _id: org._id }, { $set: { cancelling: true, previousSubId: org.subId || null, previousStripeSubId: org.stripeSubId || null } });
  }

  if (gate.provider === "stripe") {
    const price = stripePriceId(plan, interval);
    const body = new URLSearchParams({
      "mode": "subscription",
      "success_url": (process.env.PUBLIC_URL || "http://localhost:3000") + "/app?billing=success",
      "cancel_url": (process.env.PUBLIC_URL || "http://localhost:3000") + "/app?billing=cancel",
      "client_reference_id": org._id,
      "customer_email": email,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "metadata[orgId]": org._id,
      "metadata[plan]": plan,
      "subscription_data[metadata][orgId]": org._id,
      "subscription_data[metadata][plan]": plan,
    });
    const res = await fetch(STRIPE_BASE() + "/checkout/sessions", { method: "POST", headers: { Authorization: stripeAuth(), "content-type": "application/x-www-form-urlencoded" }, body });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j?.error?.message || "Stripe checkout error"), { status: 502 });
    await col("orgs").updateOne({ _id: org._id }, { $set: { pendingPlan: plan, billingProvider: "stripe", billingCurrency: "USD", stripeSessionId: j.id } });
    return { configured: true, provider: "stripe", sessionId: j.id, url: j.url };
  }

  const pid = rzpPlanId(plan);
  const res = await fetch(RZP_BASE() + "/subscriptions", {
    method: "POST", headers: { Authorization: rzpAuth(), "content-type": "application/json" },
    body: JSON.stringify({ plan_id: pid, total_count: 120, customer_notify: 1, notes: { orgId: org._id, plan, email, product: "relay", gstin: org.billing?.gstin || "", legalName: org.billing?.legalName || "" } }),
  });
  const j = await res.json();
  if (!res.ok) throw Object.assign(new Error(j?.error?.description || "Payment provider error"), { status: 502 });
  await col("orgs").updateOne({ _id: org._id }, { $set: { subId: j.id, pendingPlan: plan, billingProvider: "razorpay", billingCurrency: "INR" } });
  return { configured: true, provider: "razorpay", subscriptionId: j.id, keyId: process.env.RAZORPAY_KEY_ID };
}

export async function cancelSubscription(org) {
  const results = await cancelProviderSubscription(org, { immediate: false });
  if (!results.length) return false;
  await col("orgs").updateOne({ _id: org._id }, { $set: { cancelling: true } });
  return true;
}

export function verifyRazorpayWebhook(raw, sig) {
  const s = process.env.RAZORPAY_WEBHOOK_SECRET; if (!s || !sig || !raw) return false;
  const h = crypto.createHmac("sha256", s).update(raw).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(String(sig))); } catch { return false; }
}
export const verifyWebhook = verifyRazorpayWebhook;

export function verifyStripeWebhook(raw, sigHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader || raw == null) return false;
  const items = String(sigHeader).split(",").map((x) => x.trim().split("="));
  const t = items.find((p) => p[0] === "t")?.[1];
  const v1s = items.filter((p) => p[0] === "v1").map((p) => p[1]).filter(Boolean);
  if (!t || !v1s.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const want = crypto.createHmac("sha256", secret).update(t + "." + buf).digest("hex");
  const wantBuf = Buffer.from(want);
  return v1s.some((v1) => {
    try {
      const got = Buffer.from(String(v1));
      return got.length === wantBuf.length && crypto.timingSafeEqual(wantBuf, got);
    } catch { return false; }
  });
}

const GRACE_DAYS = () => Number(process.env.BILLING_GRACE_DAYS || 3);

export async function applyWebhook(ev) {
  const sub = ev?.payload?.subscription?.entity; if (!sub) {
    // Razorpay payment.failed
    if (ev?.event === "payment.failed" || ev?.event === "subscription.pending") {
      const notes = ev?.payload?.payment?.entity?.notes || ev?.payload?.subscription?.entity?.notes || {};
      const org = (notes.orgId && await col("orgs").findOne({ _id: notes.orgId })) || null;
      if (!org) return "unknown_org";
      const graceUntil = new Date(Date.now() + GRACE_DAYS() * 864e5).toISOString();
      await col("orgs").updateOne({ _id: org._id }, { $set: { subStatus: "past_due", graceUntil, paymentFailedAt: new Date().toISOString() } });
      return "payment_failed";
    }
    return "ignored";
  }
  const org = (sub.notes?.orgId && await col("orgs").findOne({ _id: sub.notes.orgId })) || await col("orgs").findOne({ subId: sub.id });
  if (!org) return "unknown_org";
  const plan = sub.notes?.plan || org.pendingPlan || org.plan;
  if (ev.event === "subscription.charged" || ev.event === "subscription.activated") {
    const end = sub.current_end ? new Date(sub.current_end * 1000) : new Date(Date.now() + 31 * 864e5);
    const paidUntil = new Date(end.getTime() + GRACE_DAYS() * 864e5).toISOString();
    await col("orgs").updateOne({ _id: org._id }, { $set: { plan, paidUntil, subId: sub.id, subStatus: "active", cancelling: false, graceUntil: null, paymentFailedAt: null }, $unset: { pendingPlan: "" } });
    return "activated";
  }
  if (["subscription.cancelled", "subscription.halted", "subscription.completed", "subscription.expired"].includes(ev.event)) {
    await col("orgs").updateOne({ _id: org._id }, { $set: { subStatus: ev.event.split(".")[1] } });
    return "ended";
  }
  return "ignored";
}

export async function applyStripeEvent(ev) {
  const type = ev?.type;
  const obj = ev?.data?.object;
  if (!type || !obj) return "ignored";
  const orgId = obj.metadata?.orgId || obj.client_reference_id || obj.subscription_details?.metadata?.orgId;
  let org = orgId ? await col("orgs").findOne({ _id: orgId }) : null;
  if (!org && obj.id) org = await col("orgs").findOne({ stripeSubId: obj.id });
  if (!org && obj.subscription) org = await col("orgs").findOne({ stripeSubId: obj.subscription });

  if (type === "checkout.session.completed") {
    if (!org) return "unknown_org";
    const plan = obj.metadata?.plan || org.pendingPlan;
    await col("orgs").updateOne({ _id: org._id }, { $set: { stripeCustomerId: obj.customer, stripeSubId: obj.subscription, pendingPlan: plan, billingProvider: "stripe", subStatus: "incomplete" } });
    return "checkout_completed";
  }
  if (!org) return "unknown_org";
  if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
    const plan = obj.metadata?.plan || org.pendingPlan || org.plan;
    const end = obj.current_period_end ? new Date(obj.current_period_end * 1000) : new Date(Date.now() + 31 * 864e5);
    const status = obj.status;
    if (status === "active" || status === "trialing") {
      const paidUntil = new Date(end.getTime() + GRACE_DAYS() * 864e5).toISOString();
      await col("orgs").updateOne({ _id: org._id }, { $set: { plan, paidUntil, stripeSubId: obj.id, subStatus: "active", cancelling: !!obj.cancel_at_period_end, graceUntil: null, paymentFailedAt: null }, $unset: { pendingPlan: "" } });
      return "activated";
    }
    if (status === "past_due" || status === "unpaid") {
      const graceUntil = new Date(Date.now() + GRACE_DAYS() * 864e5).toISOString();
      await col("orgs").updateOne({ _id: org._id }, { $set: { subStatus: status, graceUntil, paymentFailedAt: new Date().toISOString(), stripeSubId: obj.id } });
      return "past_due";
    }
    await col("orgs").updateOne({ _id: org._id }, { $set: { subStatus: status, stripeSubId: obj.id } });
    return "updated";
  }
  if (type === "invoice.payment_failed") {
    const graceUntil = new Date(Date.now() + GRACE_DAYS() * 864e5).toISOString();
    const o = org || (obj.subscription && await col("orgs").findOne({ stripeSubId: obj.subscription }));
    if (!o) return "unknown_org";
    await col("orgs").updateOne({ _id: o._id }, { $set: { subStatus: "past_due", graceUntil, paymentFailedAt: new Date().toISOString() } });
    return "payment_failed";
  }
  if (type === "customer.subscription.deleted") {
    await col("orgs").updateOne({ _id: org._id }, { $set: { subStatus: "cancelled" } });
    return "ended";
  }
  return "ignored";
}

/** REL-25: after grace expires, revoke send rights by clearing paidUntil into the past and marking expired. */
export async function enforceGraceExpirations(now = Date.now()) {
  const due = await col("orgs").find({ graceUntil: { $lte: new Date(now).toISOString() }, subStatus: { $in: ["past_due", "unpaid", "halted"] } }).toArray();
  for (const o of due) {
    await col("orgs").updateOne({ _id: o._id }, { $set: { paidUntil: new Date(now - 1000).toISOString(), subStatus: "expired", plan: o.plan === "trial" ? "trial" : o.plan } });
  }
  return due.length;
}
