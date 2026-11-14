import { readSignedFile } from "@/server/storage";

/** Süreli, imzalı dosya bağlantısı. İmza yalnızca grup üyesi için üretilir. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url);
  try {
    const f = await readSignedFile(id, Number(u.searchParams.get("exp")), u.searchParams.get("sig") ?? "");
    return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.mime, "cache-control": "private, no-store", "content-disposition": "inline", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch {
    return new Response("Bağlantı geçersiz ya da süresi dolmuş.", { status: 404 });
  }
}
