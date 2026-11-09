/** Browser helper for Relay API calls via Next rewrite (`/api/relay` → backend). */
export async function api(path, opts = {}) {
  const p = path.startsWith("/") ? path : "/" + path;
  const res = await fetch("/api/relay" + p, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { authorization: "Bearer " + opts.token } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body !== undefined ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
