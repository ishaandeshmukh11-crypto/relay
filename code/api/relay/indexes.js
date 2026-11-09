// Unique indexes. Refuses to start if existing rows would be collapsed. Does not delete customer data.
import { registerMemoryUniques } from "./store.js";

async function dupes(db, collection, groupId) {
  return db.collection(collection).aggregate([
    { $group: { _id: groupId, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 }, _id: { $ne: null } } },
    { $limit: 5 },
  ]).toArray();
}

export async function ensureIndexes() {
  registerMemoryUniques();
  const db = (await import("mongoose")).default.connection.db;
  const checks = [
    ["users", "$email", "users.email"],
    ["contacts", { orgId: "$orgId", phone: "$phone" }, "contacts orgId+phone"],
    ["wa_inbound", { orgId: "$orgId", metaId: "$metaId" }, "wa_inbound orgId+metaId"],
    ["webhook_inbox", "$key", "webhook_inbox.key"],
  ];
  for (const [collection, groupId, label] of checks) {
    const found = await dupes(db, collection, groupId).catch(() => []);
    if (found.length) {
      const err = new Error("Duplicate " + label + " rows exist. Unique index was not created and no rows were deleted. Resolve duplicates, then restart. Sample: " + JSON.stringify(found));
      err.code = "DUPLICATES";
      throw err;
    }
  }
  const c = (n) => db.collection(n);
  await c("users").createIndex({ email: 1 }, { unique: true, name: "users_email" });
  await c("contacts").createIndex({ orgId: 1, phone: 1 }, { unique: true, name: "contacts_org_phone" });
  await c("wa_inbound").createIndex({ orgId: 1, metaId: 1 }, { unique: true, name: "wa_inbound_meta" });
  await c("webhook_inbox").createIndex({ key: 1 }, { unique: true, name: "webhook_inbox_key" });
  await c("messages").createIndex({ wamid: 1 }, { unique: true, sparse: true, name: "messages_wamid" });
  await c("messages").createIndex({ campaignId: 1, status: 1 }, { name: "messages_campaign_status" });
  await c("webhook_inbox").createIndex({ status: 1, receivedAt: 1 }, { name: "webhook_inbox_status" });
}
