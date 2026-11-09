import crypto from "node:crypto";
const SECRET = process.env.AUTH_SECRET || (console.warn("[relay] AUTH_SECRET not set: using a random one, sessions reset on restart"), crypto.randomBytes(32).toString("hex"));
const KEY = crypto.createHash("sha256").update(process.env.ENC_KEY || SECRET).digest();
const b64 = (b) => Buffer.from(b).toString("base64url");
export const hashPw = (pw) => { const s = crypto.randomBytes(16); return s.toString("hex") + ":" + crypto.scryptSync(pw, s, 64).toString("hex"); };
export const checkPw = (pw, st) => {
  try {
    const [s, h] = String(st || "").split(":");
    if (!s || !h) return false;
    const x = crypto.scryptSync(String(pw), Buffer.from(s, "hex"), 64);
    const y = Buffer.from(h, "hex");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
};
export function timingSafeEqualStr(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
export const sign = (p, ttl = 7 * 864e5) => { const body = b64(JSON.stringify({ ...p, exp: Date.now() + ttl })); return body + "." + crypto.createHmac("sha256", SECRET).update(body).digest("base64url"); };
export const verify = (t) => { try { const [b, s] = String(t).split("."); const e = crypto.createHmac("sha256", SECRET).update(b).digest("base64url"); if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null; const p = JSON.parse(Buffer.from(b, "base64url")); return p.exp > Date.now() ? p : null; } catch { return null; } };
export const enc = (txt) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv); const d = Buffer.concat([c.update(txt, "utf8"), c.final()]); return [iv, c.getAuthTag(), d].map((x) => x.toString("base64")).join("."); };
export const dec = (s) => { const [iv, tag, d] = s.split(".").map((x) => Buffer.from(x, "base64")); const c = crypto.createDecipheriv("aes-256-gcm", KEY, iv); c.setAuthTag(tag); return Buffer.concat([c.update(d), c.final()]).toString("utf8"); };
export const requireAuth = async (req, res, next) => {
  try {
    const p = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!p) return res.status(401).json({ error: "Please sign in again." });
    const { col } = await import("./store.js");
    const u = await col("users").findOne({ _id: p.uid });
    if (!u) return res.status(401).json({ error: "Please sign in again." });
    if ((u.tokenVersion || 0) !== (p.tv || 0)) return res.status(401).json({ error: "Please sign in again." });
    // Bind session to live user/org fields (ignore stale orgId/email in the token body).
    req.user = { uid: u._id, orgId: u.orgId, email: u.email, tv: u.tokenVersion || 0 };
    next();
  } catch (e) { next(e); }
};
