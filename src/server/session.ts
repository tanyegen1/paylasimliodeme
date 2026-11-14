import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, getUserBySessionToken, type User } from "./auth";
import { env } from "./env";

const COOKIE = "pz_s";

export const getUser = cache(async (): Promise<User | null> => {
  return getUserBySessionToken((await cookies()).get(COOKIE)?.value);
});
export async function requireUser(next?: string): Promise<User> {
  const u = await getUser();
  if (!u) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return u;
}
export async function startSession(userId: string) {
  const s = await createSession(userId);
  (await cookies()).set(COOKIE, s.token, { httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/", expires: s.expires });
}
export async function endSession() {
  const jar = await cookies();
  const tok = jar.get(COOKIE)?.value;
  if (tok) await destroySession(tok);
  jar.delete(COOKIE);
}
export async function sessionToken() {
  return (await cookies()).get(COOKIE)?.value ?? "";
}
export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}
/** Yalnızca site içi yollara yönlendir (açık yönlendirme engeli). */
export function safeNext(next: unknown, fallback = "/"): string {
  return typeof next === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : fallback;
}
