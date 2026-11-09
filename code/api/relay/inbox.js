// Durable webhook inbox. A 200 is returned only after the event is stored.
import crypto from "node:crypto";
import { col, id, isDupKey } from "./store.js";

const iso = () => new Date().toISOString();
const plus = (ms) => new Date(Date.now() + ms).toISOString();

export function metaSignatureOk(raw, header, secret) {
  if (!secret || raw == null) return false;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const want = "sha256=" + crypto.createHmac("sha256", secret).update(buf).digest("hex");
  const got = String(header || "");
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function persistWebhook(source, raw, body) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(JSON.stringify(body ?? {}));
  const key = crypto.createHash("sha256").update(source).update("\n").update(buf).digest("hex");
  const doc = { _id: id(), key, source, body, status: "pending", attempts: 0, receivedAt: iso() };
  try {
    await col("webhook_inbox").insertOne(doc);
    return { key, duplicate: false, row: doc };
  } catch (e) {
    if (!isDupKey(e)) throw e;
    const row = await col("webhook_inbox").findOne({ key });
    return { key, duplicate: true, row };
  }
}

export async function completeWebhook(key, result) {
  await col("webhook_inbox").updateOne({ key }, { $set: { status: "done", result: result ?? "ok", processedAt: iso(), error: "", claimUntil: null } });
}

export async function failWebhook(key, error) {
  // attempts already incremented by claimWebhook / drain claim — do not double-count.
  const row = await col("webhook_inbox").findOne({ key });
  const attempts = row?.attempts || 0;
  await col("webhook_inbox").updateOne({ key }, {
    $set: {
      status: attempts >= 5 ? "dead" : "pending",
      error: String(error?.message || error).slice(0, 400),
      claimUntil: null,
    },
  });
}

/** Atomically claim a pending (or stale processing) webhook row. Prevents duplicate concurrent handlers. */
export async function claimWebhook(key) {
  const now = iso();
  await col("webhook_inbox").updateMany(
    { key, status: "processing", claimUntil: { $lt: now } },
    { $set: { status: "pending" } },
  );
  return col("webhook_inbox").findOneAndUpdate(
    { key, status: "pending" },
    { $set: { status: "processing", claimUntil: plus(60_000) }, $inc: { attempts: 1 } },
  );
}

export async function drainInbox(dispatch) {
  const now = iso();
  await col("webhook_inbox").updateMany({ status: "processing", claimUntil: { $lt: now } }, { $set: { status: "pending" } });
  const rows = await col("webhook_inbox").find({ status: "pending" }).limit(20).toArray();
  for (const row of rows) {
    const claimed = await col("webhook_inbox").findOneAndUpdate(
      { _id: row._id, status: "pending" },
      { $set: { status: "processing", claimUntil: plus(60_000) }, $inc: { attempts: 1 } },
    );
    if (!claimed) continue;
    try {
      const result = await dispatch(claimed);
      await completeWebhook(claimed.key, result);
    } catch (e) {
      await failWebhook(claimed.key, e);
    }
  }
}
