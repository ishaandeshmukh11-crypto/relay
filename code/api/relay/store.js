// Collection store. MongoDB when connected. In-memory only when RELAY_ALLOW_MEMORY=1 and not production.
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const mem = {};
const uniqueKeys = {};
let memoryOn = false;
let uniquesReady = false;

const get = (o, k) => o?.[k];
function match(doc, f) {
  if (f.$or) return f.$or.some((clause) => match(doc, clause));
  return Object.entries(f).every(([k, c]) => {
    if (k === "$or") return true;
    const v = k.includes(".") ? k.split(".").reduce((a, p) => a?.[p], doc) : get(doc, k);
    if (c && typeof c === "object" && !Array.isArray(c) && !(c instanceof Date) && !(c instanceof RegExp)) {
      return Object.entries(c).every(([op, x]) => {
        if (op === "$options") return true;
        return ({
          $in: () => Array.isArray(x) && x.includes(v),
          $nin: () => Array.isArray(x) && !x.includes(v),
          $ne: () => v !== x,
          $gt: () => v > x,
          $gte: () => v >= x,
          $lt: () => v < x,
          $lte: () => v <= x,
          $exists: () => (v !== undefined) === x,
          $regex: () => new RegExp(x, c.$options || "").test(String(v ?? "")),
        }[op]?.() ?? false);
      });
    }
    return v === c;
  });
}
function registerUnique(name, keys) {
  const list = (uniqueKeys[name] ||= []);
  const sig = keys.join("\0");
  if (!list.some((k) => k.join("\0") === sig)) list.push(keys);
}
export function registerMemoryUniques() {
  if (uniquesReady) return;
  uniquesReady = true;
  registerUnique("users", ["email"]);
  registerUnique("contacts", ["orgId", "phone"]);
  registerUnique("webhook_inbox", ["key"]);
  registerUnique("wa_inbound", ["orgId", "metaId"]);
  registerUnique("messages", ["wamid"]);
}
function isDup(name, doc, ignoreId) {
  const rows = mem[name] || [];
  for (const keys of uniqueKeys[name] || []) {
    if (keys.some((k) => doc[k] === undefined || doc[k] === null || doc[k] === "")) continue;
    if (rows.some((r) => r._id !== ignoreId && keys.every((k) => r[k] === doc[k]))) return true;
  }
  return false;
}
function memCol(name) {
  const rows = (mem[name] ||= []);
  const cursor = (list) => { let l = list, s = null, n = 0, sk = 0; const c = { sort(o) { s = o; return c; }, skip(x) { sk = x; return c; }, limit(x) { n = x; return c; }, async toArray() { let r = [...l]; if (s) { const [k, d] = Object.entries(s)[0]; r.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d); } if (sk) r = r.slice(sk); return (n ? r.slice(0, n) : r).map((x) => structuredClone(x)); } }; return c; };
  const apply = (d, u) => { if (u.$set) Object.assign(d, u.$set); if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) d[k] = (d[k] || 0) + v; if (u.$push) for (const [k, v] of Object.entries(u.$push)) (d[k] ||= []).push(v); };
  return {
    async insertOne(d) {
      const doc = structuredClone(d);
      doc._id ||= randomUUID();
      if (isDup(name, doc)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
      rows.push(doc);
      d._id = doc._id;
      return { insertedId: doc._id };
    },
    async insertMany(ds) { let n = 0; for (const d of ds) { await this.insertOne(d); n++; } return { insertedCount: n }; },
    find(f = {}) { return cursor(rows.filter((d) => match(d, f))); },
    async findOne(f = {}) { const d = rows.find((x) => match(x, f)); return d ? structuredClone(d) : null; },
    async updateOne(f, u, o = {}) { const d = rows.find((x) => match(x, f)); if (d) apply(d, u); else if (o.upsert) { const n = { _id: randomUUID(), ...f }; apply(n, u); if (isDup(name, n)) throw Object.assign(new Error("duplicate key"), { code: 11000 }); rows.push(n); } return { matchedCount: d ? 1 : 0 }; },
    async updateMany(f, u) { let n = 0; for (const d of rows) if (match(d, f)) { apply(d, u); n++; } return { matchedCount: n }; },
    async findOneAndUpdate(f, u) {
      const d = rows.find((x) => match(x, f));
      if (!d) return null;
      apply(d, u);
      return structuredClone(d);
    },
    async countDocuments(f = {}) { return rows.filter((d) => match(d, f)).length; },
    async deleteMany(f = {}) { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); return {}; },
  };
}
export const usingMongo = () => mongoose.connection.readyState === 1;
export const memoryEnabled = () => memoryOn;
export function enableMemory() { memoryOn = true; registerMemoryUniques(); }
export function isDupKey(e) { return e?.code === 11000 || e?.code === 11001; }
export const col = (name) => {
  if (usingMongo()) return mongoose.connection.collection(name);
  if (memoryOn) return memCol(name);
  throw Object.assign(new Error("Database unavailable"), { status: 503 });
};
export const id = () => randomUUID();
