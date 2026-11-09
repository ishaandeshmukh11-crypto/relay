// Transactional email through Resend's HTTP API (no SDK). Env: RESEND_API_KEY, MAIL_FROM ("Relay <no-reply@yourdomain.com>"), PUBLIC_URL.
// Never log verification or reset URLs. Production refuses to start without Resend (see server.js).
import { resendBase } from "./providers.js";
export const publicUrl = () => (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
function redact(text) {
  return String(text || "")
    .replace(/([?&](?:verify|reset)=)[A-Za-z0-9_-]+/gi, "$1[redacted]")
    .replace(/(\/(?:verify|reset)\/)[A-Za-z0-9_-]+/gi, "$1[redacted]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted-token]");
}
export async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw Object.assign(new Error("RESEND_API_KEY is required in production"), { status: 503 });
    console.log(`[mail:dev] to=${to} subject=${subject} body=${redact(text)}`);
    return { sent: false, dev: true };
  }
  try {
    const r = await fetch(resendBase() + "/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.MAIL_FROM || "Relay <onboarding@resend.dev>", to: [to], subject, text }) });
    if (!r.ok) console.error("[mail] Resend rejected the message", r.status);
    return { sent: r.ok };
  } catch (e) {
    console.error("[mail] send failed", e.message);
    return { sent: false };
  }
}
