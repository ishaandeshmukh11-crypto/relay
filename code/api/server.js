// TWWIOS Relay — standalone API server.
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import relay, { triggerRouter } from "./relay/routes.js";
import { startScheduler } from "./relay/sender.js";
import { usingMongo, enableMemory, memoryEnabled } from "./relay/store.js";
import { ensureIndexes } from "./relay/indexes.js";
import { parseCorsOrigins } from "./relay/cors.js";

const prod = process.env.NODE_ENV === "production";
if (prod) {
  const bad = [];
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) bad.push("AUTH_SECRET (32+ random characters)");
  if (!process.env.ENC_KEY || process.env.ENC_KEY.length < 32) bad.push("ENC_KEY (32+ random characters)");
  if (!process.env.MONGODB_URI) bad.push("MONGODB_URI");
  if (!process.env.PUBLIC_URL) bad.push("PUBLIC_URL");
  if (!process.env.CORS_ORIGIN) bad.push("CORS_ORIGIN (comma-separated web origin(s))");
  if (!process.env.WA_APP_SECRET) bad.push("WA_APP_SECRET (webhook signature check)");
  if (!process.env.WA_VERIFY_TOKEN) bad.push("WA_VERIFY_TOKEN (Meta webhook verify token)");
  if (!process.env.RESEND_API_KEY) bad.push("RESEND_API_KEY (transactional email)");
  if (!process.env.MAIL_FROM) bad.push("MAIL_FROM (transactional email from-address)");
  if (process.env.RELAY_ALLOW_MEMORY === "1") bad.push("RELAY_ALLOW_MEMORY is not allowed in production");
  if (bad.length) { console.error("Refusing to start in production. Set: " + bad.join(", ")); process.exit(1); }
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: parseCorsOrigins() }));
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (usingMongo() || memoryEnabled()) return next();
  return res.status(503).json({ error: "Database unavailable" });
});
// Rate limits live on the Relay router (auth `strict`, post-webhook `apiLimit`, trigger 600/min).
// Do not mount a global /api limiter here: it would either miss already-mounted routes or throttle Meta/Stripe webhooks.
// Canonical Relay API prefix. Legacy /api/pulse mounts stay for existing Meta/Stripe webhook URLs.
app.use("/api/relay/v1", triggerRouter);
app.use("/api/relay", relay);
app.use("/api/pulse/v1", triggerRouter);
app.use("/api/pulse", relay);
app.use(express.json({ limit: "50kb" }));
app.get("/health", (_req, res) => {
  const db = usingMongo();
  if (prod && !db) return res.status(503).json({ ok: false, product: "Relay", db: false });
  res.json({ ok: true, product: "Relay", db, storage: db ? "mongodb" : "memory" });
});
app.use((err, _req, res, _next) => {
  if (err?.name === "ZodError" || Array.isArray(err?.issues)) return res.status(400).json({ error: err.issues?.[0]?.message || "Invalid input" });
  const status = err?.status || 500;
  if (status >= 500) console.error(err?.message || err);
  res.status(status).json({ error: status === 503 ? "Database unavailable" : "Something went wrong" });
});

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const allowMemory = process.env.RELAY_ALLOW_MEMORY === "1" && !prod;
const uri = process.env.MONGODB_URI;

if (!uri && !allowMemory) {
  console.error("Refusing to start. Set MONGODB_URI.");
  process.exit(1);
}

try {
  if (uri) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: allowMemory ? 400 : 8000 });
    await ensureIndexes();
    mongoose.connection.on("disconnected", () => console.error("[relay] MongoDB disconnected. New requests are refused until it returns."));
    console.log("MongoDB connected");
  }
} catch (e) {
  if (!allowMemory) {
    console.error("Refusing to start. MongoDB connection failed: " + e.message);
    process.exit(1);
  }
  console.warn("[relay] MongoDB not connected. In-memory store enabled by RELAY_ALLOW_MEMORY. Data is lost on restart.");
  enableMemory();
}
if (!usingMongo() && !memoryEnabled()) {
  if (allowMemory) enableMemory();
  else { console.error("Refusing to start. MongoDB is not connected."); process.exit(1); }
}

if (process.env.SENTRY_DSN) {
  console.log("[relay] SENTRY_DSN is set. Wire @sentry/node in a follow-up deploy step; DSN is reserved and not logged.");
}

app.listen(port, host, () => { console.log("TWWIOS Relay API on " + host + ":" + port); startScheduler(); });

async function shutdown(signal) {
  console.log("[relay] " + signal + " received, shutting down");
  try { await mongoose.connection.close(); } catch {}
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
