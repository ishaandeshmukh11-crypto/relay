/** Parse CORS_ORIGIN into trimmed origin list. */
export function parseCorsOrigins(raw = process.env.CORS_ORIGIN) {
  const list = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ["http://localhost:3000"];
}
