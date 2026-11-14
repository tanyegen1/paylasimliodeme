import { getUser } from "@/server/session";
import { exportUserData } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Giriş gerekli", { status: 401 });
  try { rateLimit(`export:${user.id}`, 5, 3600); } catch { return new Response("Çok fazla istek. Biraz sonra tekrar dene.", { status: 429 }); }
  return new Response(JSON.stringify(await exportUserData(user.id), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="hesap-verilerim.json"', "cache-control": "private, no-store" },
  });
}
