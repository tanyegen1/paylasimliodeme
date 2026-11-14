import { NextResponse } from "next/server";
import { getUser } from "@/server/session";
import { saveAttachment } from "@/server/storage";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import { tDyn } from "@/lib/i18n";

export async function POST(req: Request) {
  try {
    const user = await getUser();
    if (!user) throw new AppError("auth_required", 401);
    rateLimit(`upload:${user.id}`, 30, 3600);
    if (Number(req.headers.get("content-length") ?? 0) > 9 * 1024 * 1024) throw new AppError("file_too_large", 413);
    const form = await req.formData();
    const file = form.get("file");
    const groupId = String(form.get("groupId") ?? "");
    const kind = String(form.get("kind") ?? "receipt");
    if (!(file instanceof File) || !["receipt", "document", "proof"].includes(kind)) throw new AppError("invalid_input");
    const saved = await saveAttachment(groupId, user.id, kind as "receipt", Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: tDyn(`errors.${e.code}`, "Dosya yüklenemedi.") }, { status: e.status });
    log.error("upload_failed", e);
    return NextResponse.json({ error: "Dosya yüklenemedi." }, { status: 500 });
  }
}
