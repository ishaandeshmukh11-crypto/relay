const API = process.env.API_URL || "http://localhost:4000";
export default {
  reactStrictMode: true,
  async rewrites() { return [{ source: "/api/:path*", destination: `${API}/api/:path*` }]; },
};
