// Thin client for the WhatsApp Cloud API (Graph API).
import { graphBase } from "./providers.js";
const base = () => graphBase();
async function graph(path, { method = "GET", token, body } = {}) {
  const ac = new AbortController();
  const ms = +(process.env.WA_FETCH_TIMEOUT_MS ?? 20000);
  const timer = setTimeout(() => ac.abort(), ms);
  let r;
  try {
    r = await fetch(base() + path, { method, signal: ac.signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    const name = e?.name || e?.cause?.name || "";
    throw Object.assign(new Error(name === "AbortError" || name === "TimeoutError" ? "WhatsApp request timed out" : (e.message || "Network error")), { code: "timeout", uncertain: true });
  } finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Graph API ${r.status}`), { code: j.error?.code, sub: j.error?.error_subcode, status: r.status, details: j.error?.error_data?.details });
  return j;
}
export const getPhone = (a) => graph(`/${a.phoneId}?fields=quality_rating,messaging_limit_tier,verified_name,display_phone_number`, { token: a.token });
export const listTemplates = (a) => graph(`/${a.wabaId}/message_templates?fields=name,status,category,language,components,rejected_reason&limit=100`, { token: a.token });
export const createTemplate = (a, { name, category, language, body, footer, example }) => graph(`/${a.wabaId}/message_templates`, { method: "POST", token: a.token, body: { name, category, language, components: [{ type: "BODY", text: body, ...(example?.length ? { example: { body_text: [example] } } : {}) }, ...(footer ? [{ type: "FOOTER", text: footer }] : [])] } });
export const sendTemplate = (a, to, { name, lang, vars = [] }) => graph(`/${a.phoneId}/messages`, { method: "POST", token: a.token, body: { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: lang }, components: vars.length ? [{ type: "body", parameters: vars.map((t) => ({ type: "text", text: String(t) })) }] : [] } } });
export const sendText = (a, to, text) => graph(`/${a.phoneId}/messages`, { method: "POST", token: a.token, body: { messaging_product: "whatsapp", to, type: "text", text: { body: text } } });

// Embedded Signup helpers. Confirm exact parameters in Meta's Embedded Signup Builder when you set up the app.
export async function exchangeCode(code) {
  const q = new URLSearchParams({ client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, code });
  const r = await fetch(`${base()}/oauth/access_token?${q}`); const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error?.message || "Code exchange failed"); return j;
}
export const subscribeApp = (a) => graph(`/${a.wabaId}/subscribed_apps`, { method: "POST", token: a.token, body: {} });
export const registerPhone = (a, pin) => graph(`/${a.phoneId}/register`, { method: "POST", token: a.token, body: { messaging_product: "whatsapp", pin } });
