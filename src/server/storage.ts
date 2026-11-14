import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import { q1, pool } from "./db";
import { AppError, notFound } from "./errors";
import { requireMember } from "./groups";
import { signFile, safeEqual } from "./tokens";
import { audit } from "./audit";

const MAX_BYTES = 8 * 1024 * 1024;
const LINK_TTL_SEC = 300;

/** Dosya türü, uzantıya ya da istemcinin beyanına değil içeriğin ilk baytlarına göre belirlenir. */
export function sniffMime(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (b.length > 5 && b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

const root = () => resolve(env.storageDir);
const pathFor = (key: string) => {
  const p = resolve(root(), key);
  if (!p.startsWith(root())) throw notFound();
  return p;
};

/** Özel depolama: dosyalar herkese açık bir klasörde tutulmaz, yalnızca imzalı ve süreli bağlantıyla sunulur. */
export async function saveAttachment(groupId: string, userId: string, kind: "receipt" | "document" | "proof", bytes: Buffer) {
  await requireMember(groupId, userId);
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new AppError("file_too_large");
  const mime = sniffMime(bytes);
  if (!mime) throw new AppError("file_type_invalid");
  const key = `${groupId}/${randomUUID()}`;
  await mkdir(join(root(), groupId), { recursive: true });
  await writeFile(pathFor(key), bytes, { mode: 0o600 });
  const row = await q1(
    `insert into attachments (group_id, uploader_user_id, kind, mime, size_bytes, storage_key) values ($1,$2,$3,$4,$5,$6) returning id`,
    [groupId, userId, kind, mime, bytes.length, key]);
  await audit(pool, { groupId, userId, type: "attachment.uploaded", entityType: "attachment", entityId: row!.id, data: { kind, mime } });
  return { id: row!.id as string, mime };
}

export async function readAttachmentForMember(groupId: string, userId: string, attachmentId: string) {
  await requireMember(groupId, userId);
  const a = await q1(`select * from attachments where id=$1 and group_id=$2 and deleted_at is null`, [attachmentId, groupId]);
  if (!a) throw notFound();
  return { bytes: await readFile(pathFor(a.storage_key)), mime: a.mime as string };
}

/** Yalnızca grup üyesine, 5 dakika geçerli imzalı bağlantı üretir. */
export async function signedFileUrl(groupId: string, userId: string, attachmentId: string) {
  await requireMember(groupId, userId);
  const a = await q1(`select id from attachments where id=$1 and group_id=$2 and deleted_at is null`, [attachmentId, groupId]);
  if (!a) throw notFound();
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC;
  return `/api/files/${attachmentId}?exp=${exp}&sig=${signFile(attachmentId, exp)}`;
}
export async function readSignedFile(attachmentId: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000 || !safeEqual(sig, signFile(attachmentId, exp))) throw notFound();
  const a = await q1(`select storage_key, mime from attachments where id=$1 and deleted_at is null`, [attachmentId]);
  if (!a) throw notFound();
  return { bytes: await readFile(pathFor(a.storage_key)), mime: a.mime as string };
}
export async function deleteAttachmentFile(key: string) {
  await unlink(pathFor(key)).catch(() => {});
}
