// Shield: pure rules that keep sending inside WhatsApp's policies. No I/O here, so it is easy to test.
// Quotas follow the customer guide conversation caps (Starter 1,000 / Growth 10,000).
export const PLANS = {
  trial: { label: "Trial", contacts: 200, marketingPerMonth: 300, socialPerMonth: 100 },
  starter: { label: "Starter", contacts: 5000, marketingPerMonth: 1000, socialPerMonth: 2000 },
  growth: { label: "Growth", contacts: 50000, marketingPerMonth: 10000, socialPerMonth: 20000 },
};
// Meta's `messaging_limit_tier` -> unique users per rolling 24h. New portfolios start at 250.
export const TIERS = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: Infinity };
export const tierLimit = (t) => TIERS[t] ?? 250;

/** ISO 3166-1 alpha-2 → E.164 country calling code (common set; extend via DEFAULT_COUNTRY on the org). */
export const COUNTRY_DIAL = {
  IN: "91", US: "1", CA: "1", GB: "44", AE: "971", SG: "65", AU: "61", DE: "49", FR: "33",
  NL: "31", IE: "353", NZ: "64", ZA: "27", BR: "55", MX: "52", PH: "63", MY: "60", ID: "62",
  PK: "92", BD: "880", LK: "94", NP: "977", SA: "966", QA: "974", KW: "965", BH: "973", OM: "968",
};
/**
 * Normalize to E.164 digits without '+'.
 * Never assumes India for bare local numbers — requires country or an already-international number.
 */
export function normalizePhone(p, country) {
  let raw = String(p || "").trim();
  if (raw.startsWith("+")) raw = raw.slice(1);
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length >= 11 && d.length <= 15) return d; // already international
  const cc = COUNTRY_DIAL[String(country || "").toUpperCase()];
  if (!cc) return null; // local number without an explicit country is rejected
  if (d.length >= 8 && d.length <= 12) {
    if (d.startsWith("0")) return cc + d.replace(/^0+/, "");
    return cc + d;
  }
  return null;
}

const OPT = ["stop", "unsubscribe", "cancel", "opt out", "optout", "remove me", "dont message", "do not message", "band karo", "band kar do", "mat bhejo", "रोको", "बंद", "बंद करो", "मत भेजो", "बन्द करो"];
export const isOptOut = (t) => { const x = String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, "").replace(/\s+/g, " ").trim(); return !!x && OPT.some((w) => x === w || x.startsWith(w + " ")); };

const DAY = 864e5;
// Reasons a contact may NOT receive a marketing message right now.
export function blockReason(c, now = Date.now(), cfg = {}) {
  const { perDay = 1, perWeek = 2, fatigue = 4 } = cfg;
  if (!c.phone) return "invalid_number";
  if (c.optedOut) return "opted_out";
  if (!c.optIn?.source) return "no_consent";
  const mk = (c.mkt || []).map((x) => new Date(x).getTime());
  if (mk.filter((t) => now - t < DAY).length >= perDay) return "frequency_24h";
  if (mk.filter((t) => now - t < 7 * DAY).length >= perWeek) return "frequency_7d";
  if ((c.unreadStreak || 0) >= fatigue) return "fatigued";
  return null;
}
// Higher = more likely to engage = send first (protects quality rating).
export function score(c, now = Date.now()) {
  let s = 0; const d = (x) => (x ? (now - new Date(x).getTime()) / DAY : Infinity);
  if (d(c.lastReplyAt) <= 30) s += 50; if (d(c.lastReadAt) <= 14) s += 30; if (c.isCustomer) s += 20;
  return s - (c.unreadStreak || 0) * 5;
}
export function planCampaign(contacts, { dailyCapacity = 250, now = Date.now(), ...cfg } = {}) {
  const eligible = [], blocked = [], reasons = {};
  for (const c of contacts) { const r = blockReason(c, now, cfg); if (r) { blocked.push({ phone: c.phone, reason: r }); reasons[r] = (reasons[r] || 0) + 1; } else eligible.push(c); }
  eligible.sort((a, b) => score(b, now) - score(a, now));
  const canary = Math.min(eligible.length, Math.max(5, Math.ceil(eligible.length * 0.05)));
  const cap = Math.max(1, dailyCapacity);
  return { eligible, blocked, reasons, canary, days: eligible.length ? Math.ceil(eligible.length / cap) : 0 };
}
const SHORT = /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|cutt\.ly|rb\.gy|is\.gd)\b/i;
const PROMO = /\b(sale|offer|discount|% ?off|deal|cashback|coupon|buy now|limited time)\b/i;
export function lintTemplate({ category = "MARKETING", body = "", name = "" }) {
  const errors = [], warnings = [];
  if (!/^[a-z0-9_]{1,512}$/.test(name)) errors.push("Name must use only lowercase letters, numbers and underscores.");
  if (!body.trim()) errors.push("Message body is empty.");
  if (body.length > 1024) errors.push("Body is longer than 1,024 characters.");
  const vars = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => +m[1]);
  vars.forEach((n, i) => { if (n !== i + 1) errors.push("Variables must be numbered {{1}}, {{2}}, ... in order."); });
  if (/^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*$/.test(body)) errors.push("Meta rejects templates that start or end with a variable. Add text around it.");
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) errors.push("Two variables next to each other are rejected. Put words between them.");
  if (/\n{3,}|\t| {5,}/.test(body)) errors.push("Remove tabs, 3+ new lines in a row, and 5+ spaces in a row.");
  if (SHORT.test(body)) errors.push("Link shorteners (bit.ly etc.) get templates rejected. Use your own domain.");
  const letters = body.replace(/[^A-Za-z]/g, ""); if (letters.length > 20 && body.replace(/[^A-Z]/g, "").length / letters.length > 0.3) warnings.push("Too many capital letters reads as spam.");
  if ((body.match(/!/g) || []).length > 2) warnings.push("Several exclamation marks raise spam reports.");
  if ((body.match(/\p{Extended_Pictographic}/gu) || []).length > 4) warnings.push("Too many emojis.");
  if (vars.length && body.replace(/\{\{\d+\}\}/g, "").trim().length / vars.length < 20) warnings.push("Too little fixed text per variable.");
  if (category === "UTILITY" && PROMO.test(body)) warnings.push("Promotional words in a Utility template: Meta may re-categorise it as Marketing, which costs more.");
  if (category === "MARKETING" && !/\b(stop|unsubscribe|opt.?out)\b|रोको/i.test(body)) warnings.push('Add an opt-out line such as "Reply STOP to unsubscribe".');
  return { ok: !errors.length, errors, warnings };
}
// Decide whether a running campaign should continue, slow down or pause.
export function guard({ sent = 0, failed = 0, spamErrors = 0, quality }) {
  if (quality === "RED") return { action: "pause", why: "WhatsApp quality rating is Low (red)." };
  if (spamErrors > 0) return { action: "pause", why: "WhatsApp reported a spam-rate limit (error 131048)." };
  const rate = sent ? failed / sent : 0;
  if (sent >= 20 && rate > 0.15) return { action: "pause", why: `${Math.round(rate * 100)}% of messages failed.` };
  if (quality === "YELLOW" || (sent >= 20 && rate > 0.08)) return { action: "slow", why: quality === "YELLOW" ? "Quality rating is Medium (yellow)." : `${Math.round(rate * 100)}% of messages failed.` };
  return { action: "continue", why: "" };
}

// Reply intent for B2B sales: transparent keyword rules (English, Hinglish, Hindi), no black box.
const INTENT = [
  ["cold", /\b(not interested|no thanks|dont call|do not call|nahi chahiye|nahin chahiye|not now|wrong number)\b|नहीं चाहिए|रुचि नहीं/i],
  ["later", /\b(later|next month|next week|baad mein|call me tomorrow|busy)\b|बाद में/i],
  ["hot", /\b(price|pricing|quote|quotation|cost|demo|interested|call me|call|catalogue|catalog|details|send|yes|haan|ha|rate)\b|कीमत|हाँ|जानकारी/i],
];
export const intentOf = (t) => { const x = String(t || ""); for (const [k, re] of INTENT) if (re.test(x)) return k; return "other"; };
export const companyKey = (c) => String(c.fields?.company || c.fields?.Company || "").trim().toLowerCase();
