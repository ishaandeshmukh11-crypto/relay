// Production allowlists for outbound provider bases (SSRF hardening).
// Non-production also allows http://127.0.0.1 for local mocks.

const PROD = () => process.env.NODE_ENV === "production";
/** Tests may set NODE_ENV=production with local mocks; never set this in real production. */
const LOCAL_OK = () => !PROD() || process.env.RELAY_ALLOW_LOCAL_PROVIDERS === "1";

const RULES = {
  graph: [/^https:\/\/graph\.facebook\.com(?::\d+)?(?:\/|$)/i],
  stripe: [/^https:\/\/api\.stripe\.com(?::\d+)?(?:\/|$)/i],
  razorpay: [/^https:\/\/api\.razorpay\.com(?::\d+)?(?:\/|$)/i],
  resend: [/^https:\/\/api\.resend\.com(?::\d+)?(?:\/|$)/i],
};

const LOCAL = [/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i, /^http:\/\/localhost(?::\d+)?(?:\/|$)/i];

export function assertProviderBase(kind, value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) throw Object.assign(new Error("Missing " + kind + " API base"), { status: 500 });
  const allowed = [...(RULES[kind] || []), ...(LOCAL_OK() ? LOCAL : [])];
  if (!allowed.some((re) => re.test(raw))) {
    throw Object.assign(new Error("Refusing untrusted " + kind + " API base"), { status: 500, code: "BAD_PROVIDER_BASE" });
  }
  return raw.replace(/\/$/, "");
}

export const graphBase = () => assertProviderBase("graph", process.env.GRAPH_BASE, "https://graph.facebook.com/v21.0");
export const stripeBase = () => assertProviderBase("stripe", process.env.STRIPE_BASE, "https://api.stripe.com/v1");
export const razorpayBase = () => assertProviderBase("razorpay", process.env.RAZORPAY_BASE, "https://api.razorpay.com/v1");
export const resendBase = () => assertProviderBase("resend", process.env.RESEND_BASE, "https://api.resend.com");
