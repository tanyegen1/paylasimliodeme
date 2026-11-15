// Uygulama bir vekil sunucunun arkasında çalışıyorsa (ör. GitHub Codespaces) sunucu eylemlerinin
// kabul edeceği ek adresler. Virgülle ayrılmış liste, ör. "*.app.github.dev".
const extraOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  experimental: { serverActions: { bodySizeLimit: "1mb", allowedOrigins: extraOrigins } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
      // Davet ve ödeme bağlantıları arama motorlarına ve referrer'a sızmasın.
      {
        source: "/(join|pay)/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default nextConfig;
