import "server-only";
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { q, q1, tx, type Db, pool } from "./db";
import { AppError } from "./errors";
import { hashToken, newToken } from "./tokens";
import { normalizeIban } from "@/lib/iban";
import { audit } from "./audit";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 90;

export type User = {
  id: string; display_name: string; email: string | null; is_guest: boolean; is_demo: boolean;
  iban: string | null; iban_holder: string | null; timezone: string; marketing_opt_in: boolean; created_at: Date;
};
const USER_COLS = "id, display_name, email, is_guest, is_demo, iban, iban_holder, timezone, marketing_opt_in, created_at";

const nameSchema = z.string().trim().min(1, "name_required").max(60);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8, "password_short").max(200);

export function parse<T>(schema: z.ZodType<T>, value: unknown, code = "invalid_input"): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues[0]?.message ?? "";
    throw new AppError(/^[a-z_]+$/.test(msg) ? msg : code);
  }
  return r.data;
}

async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
async function verifyPassword(pw: string, stored: string) {
  const [, saltHex, keyHex] = stored.split("$");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}

/** Yalnızca isimle hızlı başlangıç. Kimlik bu cihazdaki oturuma bağlıdır; sonradan güvenceye alınabilir. */
export async function createGuestUser(input: { name: string; termsAccepted: boolean }, db: Db = pool): Promise<User> {
  const name = parse(nameSchema, input.name, "name_required");
  if (!input.termsAccepted) throw new AppError("terms_required");
  const u = await q1<User>(
    `insert into users (display_name, is_guest, terms_accepted_at) values ($1, true, now()) returning ${USER_COLS}`, [name], db);
  await db.query(`insert into notification_prefs (user_id) values ($1)`, [u!.id]);
  return u!;
}

export async function registerUser(input: { name: string; email: string; password: string; termsAccepted: boolean; marketing?: boolean }): Promise<User> {
  const name = parse(nameSchema, input.name, "name_required");
  const email = parse(emailSchema, input.email, "email_invalid");
  const password = parse(passwordSchema, input.password, "password_short");
  if (!input.termsAccepted) throw new AppError("terms_required");
  const hash = await hashPassword(password);
  try {
    return await tx(async (db) => {
      const u = await q1<User>(
        `insert into users (display_name, email, password_hash, is_guest, terms_accepted_at, marketing_opt_in, marketing_opt_in_at)
         values ($1,$2,$3,false,now(),$4, case when $4 then now() end) returning ${USER_COLS}`,
        [name, email, hash, !!input.marketing], db);
      await db.query(`insert into notification_prefs (user_id) values ($1)`, [u!.id]);
      return u!;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AppError("email_taken");
    throw e;
  }
}

/** Misafir hesabı e-posta + parola ile güvenceye alır; aynı kimliğe başka cihazdan girilebilir. */
export async function secureAccount(userId: string, input: { email: string; password: string }): Promise<void> {
  const email = parse(emailSchema, input.email, "email_invalid");
  const password = parse(passwordSchema, input.password, "password_short");
  const hash = await hashPassword(password);
  try {
    await tx(async (db) => {
      const r = await db.query(
        `update users set email=$2, password_hash=$3, is_guest=false where id=$1 and is_guest and deleted_at is null`, [userId, email, hash]);
      if (!r.rowCount) throw new AppError("already_secured");
      // Sınırlı misafir üyelikleri tam üyeliğe yükselir.
      await db.query(`update members set role='member' where user_id=$1 and role='guest'`, [userId]);
      await audit(db, { userId, type: "account.secured" });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AppError("email_taken");
    throw e;
  }
}

export async function login(input: { email: string; password: string }): Promise<User> {
  const email = parse(emailSchema, input.email, "login_failed");
  const row = await q1<User & { password_hash: string | null }>(
    `select ${USER_COLS}, password_hash from users where lower(email)=$1 and deleted_at is null`, [email]);
  // Kullanıcı yoksa da aynı süreyi harca (kullanıcı sayımı engeli).
  const ok = await verifyPassword(input.password ?? "", row?.password_hash ?? "scrypt$00$00").catch(() => false);
  if (!row || !row.password_hash || !ok) throw new AppError("login_failed", 401);
  const { password_hash: _, ...user } = row;
  return user;
}

export async function changePassword(userId: string, current: string, next: string) {
  const row = await q1(`select password_hash from users where id=$1`, [userId]);
  if (!row?.password_hash || !(await verifyPassword(current, row.password_hash))) throw new AppError("login_failed", 401);
  const hash = await hashPassword(parse(passwordSchema, next, "password_short"));
  await q(`update users set password_hash=$2 where id=$1`, [userId, hash]);
  await q(`delete from sessions where user_id=$1`, [userId]);
}

export async function createSession(userId: string, db: Db = pool): Promise<{ token: string; expires: Date }> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2,$3)`, [hashToken(token), userId, expires]);
  return { token, expires };
}
export async function getUserBySessionToken(token: string | undefined): Promise<User | null> {
  if (!token || token.length < 20) return null;
  const u = await q1<User>(
    `select ${USER_COLS.split(", ").map((c) => "u." + c).join(", ")} from sessions s join users u on u.id = s.user_id
     where s.token_hash=$1 and s.expires_at > now() and u.deleted_at is null`, [hashToken(token)]);
  if (u) void pool.query(`update sessions set last_seen_at=now() where token_hash=$1 and last_seen_at < now() - interval '1 hour'`, [hashToken(token)]).catch(() => {});
  return u;
}
export async function destroySession(token: string) {
  await q(`delete from sessions where token_hash=$1`, [hashToken(token)]);
}
export async function destroyOtherSessions(userId: string, keepToken: string) {
  await q(`delete from sessions where user_id=$1 and token_hash<>$2`, [userId, hashToken(keepToken)]);
}

export async function updateProfile(userId: string, input: { name: string; iban?: string; ibanHolder?: string; marketing?: boolean }) {
  const name = parse(nameSchema, input.name, "name_required");
  let iban: string | null = null;
  if (input.iban && input.iban.trim()) {
    iban = normalizeIban(input.iban);
    if (!iban) throw new AppError("iban_invalid");
  }
  const holder = input.ibanHolder?.trim().slice(0, 80) || null;
  await tx(async (db) => {
    await db.query(
      `update users set display_name=$2, iban=$3, iban_holder=$4,
         marketing_opt_in=$5, marketing_opt_in_at = case when $5 and not marketing_opt_in then now() else marketing_opt_in_at end
       where id=$1`, [userId, name, iban, iban ? holder ?? name : null, !!input.marketing]);
    await audit(db, { userId, type: "profile.updated", data: { iban_set: !!iban } });
  });
}

export type Prefs = { reminders: boolean; payment_updates: boolean; group_activity: boolean; channel_email: boolean; channel_push: boolean };
export async function getPrefs(userId: string): Promise<Prefs> {
  return (await q1<Prefs>(`select reminders, payment_updates, group_activity, channel_email, channel_push from notification_prefs where user_id=$1`, [userId]))
    ?? { reminders: true, payment_updates: true, group_activity: true, channel_email: false, channel_push: false };
}
export async function setPrefs(userId: string, p: Prefs) {
  await q(
    `insert into notification_prefs (user_id, reminders, payment_updates, group_activity, channel_email, channel_push) values ($1,$2,$3,$4,$5,$6)
     on conflict (user_id) do update set reminders=$2, payment_updates=$3, group_activity=$4, channel_email=$5, channel_push=$6`,
    [userId, !!p.reminders, !!p.payment_updates, !!p.group_activity, !!p.channel_email, !!p.channel_push]);
}

/** Hesap dışa aktarımı: kullanıcının kendi verisi ve üyesi olduğu gruplardaki kendi kayıtları. */
export async function exportUserData(userId: string) {
  const user = await q1(`select id, display_name, email, iban, iban_holder, timezone, marketing_opt_in, terms_accepted_at, created_at from users where id=$1`, [userId]);
  const memberships = await q(
    `select m.id as member_id, g.id as group_id, g.name as group_name, g.type, m.display_name, m.role, m.status, m.joined_at
     from members m join groups g on g.id=m.group_id where m.user_id=$1`, [userId]);
  const ids = memberships.map((m) => m.member_id);
  const paid = await q(
    `select e.group_id, e.title, e.expense_date, e.currency, p.amount_minor as paid_minor from expense_payers p join expenses e on e.id=p.expense_id
     where p.member_id = any($1) and e.deleted_at is null`, [ids]);
  const shares = await q(
    `select e.group_id, e.title, e.expense_date, e.currency, a.amount_minor as share_minor from expense_allocations a join expenses e on e.id=a.expense_id
     where a.member_id = any($1) and e.deleted_at is null`, [ids]);
  const payments = await q(
    `select group_id, from_member, to_member, amount_minor, currency, source, created_at, reversed_at from payments where from_member = any($1) or to_member = any($1)`, [ids]);
  const reports = await q(`select group_id, amount_minor, currency, status, created_at from manual_payment_reports where reported_by_user=$1`, [userId]);
  const prefs = await getPrefs(userId);
  await q(`insert into data_requests (user_id, kind) values ($1,'export')`, [userId]);
  return { exported_at: new Date().toISOString(), user, notification_prefs: prefs, memberships, paid, shares, payments, manual_payment_reports: reports };
}

/**
 * Hesap silme. Kişisel veriler (ad, e-posta, IBAN, parola, oturumlar, bildirimler) silinir.
 * Diğer üyelerin hesap bütünlüğü için grup içindeki harcama/ödeme kayıtları korunur;
 * üyelik satırı hesaptan koparılır ve adı "Ayrılan üye" olarak anonimleştirilir.
 */
export async function deleteAccount(userId: string) {
  await tx(async (db) => {
    const ms = await q(`select id, group_id from members where user_id=$1`, [userId], db);
    for (const m of ms) {
      const used = await q1(
        `select 1 from expense_payers where member_id=$1 union all select 1 from expense_allocations where member_id=$1
         union all select 1 from payments where from_member=$1 or to_member=$1 limit 1`, [m.id], db);
      if (used) {
        await db.query(`update members set user_id=null, display_name='Ayrılan üye', status='left', left_at=coalesce(left_at, now()) where id=$1`, [m.id]);
      } else {
        await db.query(`update members set user_id=null, display_name='Ayrılan üye', status='left', left_at=coalesce(left_at, now()) where id=$1`, [m.id]);
      }
      await audit(db, { groupId: m.group_id, memberId: m.id, type: "member.account_deleted" });
      // Grupta yönetici kalmadıysa en eski aktif hesaplı üyeyi yönetici yap.
      await db.query(
        `update members set role='admin' where id = (
           select id from members where group_id=$1 and status='active' and user_id is not null order by joined_at limit 1)
         and not exists (select 1 from members where group_id=$1 and status='active' and role='admin' and user_id is not null)`, [m.group_id]);
    }
    await db.query(`delete from sessions where user_id=$1`, [userId]);
    await db.query(`delete from notifications where user_id=$1`, [userId]);
    await db.query(`delete from notification_prefs where user_id=$1`, [userId]);
    await db.query(`delete from claim_requests where user_id=$1`, [userId]);
    await db.query(`delete from entitlements where user_id=$1`, [userId]);
    await db.query(
      `update users set display_name='Silinmiş hesap', email=null, password_hash=null, iban=null, iban_holder=null,
         marketing_opt_in=false, deleted_at=now() where id=$1`, [userId]);
    await db.query(`insert into data_requests (user_id, kind) values ($1,'delete')`, [userId]);
  });
}
