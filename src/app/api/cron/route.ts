import { NextResponse } from "next/server";
import { runJobs } from "@/server/jobs";
import { env } from "@/server/env";
import { safeEqual } from "@/server/tokens";

/** Zamanlanmış işler. Günde en az bir kez çağrılmalı: Authorization: Bearer $CRON_SECRET */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runJobs());
}
