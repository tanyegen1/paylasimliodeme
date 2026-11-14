import "server-only";
import { q, q1, tx, pool } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { hashToken, newToken } from "./tokens";
import { requireAdmin, requireFullMember, requireMember, type Member } from "./groups";
import { audit } from "./audit";
import { track } from "./analytics";
import { notify } from "./notify";
import { env } from "./env";

const DEFAULT_DAYS = 7;

/** Davet bağlantısı üretir. Belirteç yalnızca bu anda döner; veritabanında özeti saklanır. */
export async function createInvite(groupId: string, userId: string, opts: { targetMemberId?: string | null; days?: number } = {}) {
  const me = await requireMember(groupId, userId);
  requireFullMember(me);
  const days = Math.min(Math.max(opts.days ?? DEFAULT_DAYS, 1), 30);
  let target: Member | null = null;
  if (opts.targetMemberId) {
    // Kişiye özel davet geçici üyeyi doğrudan bağlar; bu yüzden yalnızca yönetici üretebilir.
    if (me.role !== "admin") throw forbidden();
    target = await q1<Member>(`select * from members where id=$1 and group_id=$2 and status='active' and user_id is null`, [opts.targetMemberId, groupId]);
    if (!target) throw new AppError("target_not_placeholder");
  }
  const token = newToken();
  const row = await q1(
    `insert into invitations (group_id, token_hash, created_by, target_member_id, max_uses, expires_at)
     values ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) returning id, expires_at`,
    [groupId, hashToken(token), me.id, target?.id ?? null, target ? 1 : null, days]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "invite.created", entityType: "invitation", entityId: row!.id, data: { targeted: !!target } });
  return { id: row!.id as string, token, url: `${env.appUrl}/join/${token}`, expiresAt: row!.expires_at as Date, targetName: target?.display_name ?? null };
}

export async function listInvites(groupId: string, userId: string) {
  await requireMember(groupId, userId);
  return q(
    `select i.id, i.expires_at, i.revoked_at, i.use_count, i.max_uses, i.created_at, t.display_name as target_name, c.display_name as created_by_name
     from invitations i join members c on c.id=i.created_by left join members t on t.id=i.target_member_id
     where i.group_id=$1 and i.revoked_at is null and i.expires_at > now() and (i.max_uses is null or i.use_count < i.max_uses)
     order by i.created_at desc`, [groupId]);
}
export async function revokeInvite(groupId: string, userId: string, inviteId: string) {
  const me = await requireAdmin(groupId, userId);
  await q(`update invitations set revoked_at=now() where id=$1 and group_id=$2`, [inviteId, groupId]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "invite.revoked", entityId: inviteId });
}
export async function trackInviteShared(groupId: string, userId: string, via: string) {
  await requireMember(groupId, userId);
  await track("invite_shared", { userId, groupId }, { via });
}

async function findInvite(token: string) {
  if (!token || token.length < 30 || token.length > 100) return null;
  return q1(
    `select i.*, g.name as group_name, g.type as group_type, g.archived_at from invitations i join groups g on g.id=i.group_id where i.token_hash=$1`, [hashToken(token)]);
}
function inviteState(inv: Awaited<ReturnType<typeof findInvite>>): "ok" | "invalid" | "revoked" | "expired" | "used" {
  if (!inv || inv.archived_at) return "invalid";
  if (inv.revoked_at) return "revoked";
  if (new Date(inv.expires_at) <= new Date()) return "expired";
  if (inv.max_uses != null && inv.use_count >= inv.max_uses) return "used";
  return "ok";
}

/**
 * Üyelik öncesi güvenli önizleme: yalnızca grup adı, türü, üye sayısı, davet edenin adı
 * ve (sahiplenilebilmesi için) geçici üyelerin adları. Harcama, bakiye, IBAN GÖSTERİLMEZ.
 */
export async function previewInvite(token: string, userId?: string | null) {
  const inv = await findInvite(token);
  const state = inviteState(inv);
  if (state !== "ok" || !inv) return { state: state as Exclude<typeof state, "ok"> };
  const inviter = await q1(`select display_name from members where id=$1`, [inv.created_by]);
  const count = await q1(`select count(*)::int n from members where group_id=$1 and status='active'`, [inv.group_id]);
  const placeholders = inv.target_member_id
    ? await q<{ id: string; display_name: string }>(`select id, display_name from members where id=$1 and user_id is null and status='active'`, [inv.target_member_id])
    : await q<{ id: string; display_name: string }>(`select id, display_name from members where group_id=$1 and user_id is null and status='active' order by position`, [inv.group_id]);
  let already = false;
  let pendingClaim = false;
  if (userId) {
    already = !!(await q1(`select 1 from members where group_id=$1 and user_id=$2 and status='active'`, [inv.group_id, userId]));
    pendingClaim = !!(await q1(`select 1 from claim_requests where group_id=$1 and user_id=$2 and status='pending'`, [inv.group_id, userId]));
  }
  return {
    state: "ok" as const, groupId: inv.group_id as string, groupName: inv.group_name as string, groupType: inv.group_type as string,
    memberCount: count!.n as number, inviterName: (inviter?.display_name ?? "") as string,
    targeted: !!inv.target_member_id, placeholders, already, pendingClaim, expiresAt: inv.expires_at as Date,
  };
}
export async function trackInviteOpened(token: string) {
  const inv = await findInvite(token);
  if (inv && inviteState(inv) === "ok") await track("invite_opened", { groupId: inv.group_id }, { kind: inv.target_member_id ? "personal" : "general" });
}

/**
 * Davetle katılım.
 *  - Kişiye özel davet: yöneticinin o kişi için ürettiği tek kullanımlık bağlantı, geçici üyeyi doğrudan bağlar.
 *  - Genel davet + claimMemberId: "ben bu kişiyim" talebi oluşur, yönetici onaylayana kadar erişim verilmez.
 *  - Genel davet: yeni üye olarak katılır.
 */
export async function joinViaInvite(userId: string, token: string, opts: { claimMemberId?: string | null } = {}) {
  const res = await tx(async (db) => {
    const inv = await q1(`select * from invitations where token_hash=$1 for update`, [hashToken(token ?? "")], db);
    const g = inv ? await q1(`select archived_at from groups where id=$1`, [inv.group_id], db) : null;
    const state = inviteState(inv ? { ...inv, archived_at: g?.archived_at } : null);
    if (state !== "ok" || !inv) throw new AppError(`invite_${state}`, 410);
    const user = await q1(`select display_name, is_guest from users where id=$1 and deleted_at is null`, [userId], db);
    if (!user) throw forbidden();
    const groupId = inv.group_id as string;
    const role = user.is_guest ? "guest" : "member";

    const existing = await q1<Member>(`select * from members where group_id=$1 and user_id=$2 for update`, [groupId, userId], db);
    if (existing?.status === "active") return { groupId, status: "already" as const };
    if (existing) {
      await db.query(`update members set status='active', left_at=null, role=$2 where id=$1`, [existing.id, role]);
      await db.query(`update invitations set use_count=use_count+1 where id=$1`, [inv.id]);
      await audit(db, { groupId, userId, memberId: existing.id, type: "member.rejoined" });
      return { groupId, status: "joined" as const };
    }

    if (inv.target_member_id) {
      const r = await db.query(
        `update members set user_id=$2, role=$3, joined_at=now() where id=$1 and user_id is null and status='active' returning id`,
        [inv.target_member_id, userId, role]);
      if (!r.rowCount) throw new AppError("invite_used", 410);
      await db.query(`update invitations set use_count=use_count+1 where id=$1`, [inv.id]);
      await audit(db, { groupId, userId, memberId: inv.target_member_id, type: "member.joined", data: { via: "personal_invite" } });
      return { groupId, status: "joined" as const };
    }

    if (opts.claimMemberId) {
      const ph = await q1(`select id, display_name from members where id=$1 and group_id=$2 and user_id is null and status='active'`, [opts.claimMemberId, groupId], db);
      if (!ph) throw new AppError("target_not_placeholder");
      await db.query(`update claim_requests set status='rejected', decided_at=now() where group_id=$1 and user_id=$2 and status='pending'`, [groupId, userId]);
      await db.query(`insert into claim_requests (group_id, member_id, user_id) values ($1,$2,$3)`, [groupId, ph.id, userId]);
      await audit(db, { groupId, userId, type: "claim.requested", entityType: "member", entityId: ph.id });
      const admins = await q(`select user_id from members where group_id=$1 and role='admin' and status='active'`, [groupId], db);
      for (const a of admins) await notify(db, { userId: a.user_id, groupId, type: "claim_requested", category: "group_activity", data: { name: user.display_name, placeholder: ph.display_name } });
      return { groupId, status: "claim_pending" as const };
    }

    // Aynı isim varsa karışmasın diye ayırt edici ek.
    let name = user.display_name as string;
    const clash = await q1(`select 1 from members where group_id=$1 and status='active' and lower(display_name)=lower($2)`, [groupId, name], db);
    if (clash) name = `${name} (yeni)`.slice(0, 60);
    const m = await q1(
      `insert into members (group_id, user_id, display_name, role, position)
       values ($1,$2,$3,$4,(select coalesce(max(position),0)+1 from members where group_id=$1)) returning id`, [groupId, userId, name, role], db);
    await db.query(`update invitations set use_count=use_count+1 where id=$1`, [inv.id]);
    await audit(db, { groupId, userId, memberId: m!.id, type: "member.joined", data: { via: "invite" } });
    return { groupId, status: "joined" as const };
  });
  if (res.status === "joined") await track("member_joined", { userId, groupId: res.groupId }, { via: opts.claimMemberId ? "claim" : "invite" });
  return res;
}

export async function cancelClaim(userId: string, groupId: string) {
  await q(`update claim_requests set status='rejected', decided_at=now() where group_id=$1 and user_id=$2 and status='pending'`, [groupId, userId]);
}
export async function listClaims(groupId: string, userId: string) {
  const me = await requireMember(groupId, userId);
  if (me.role !== "admin") return [];
  return q<{ id: string; member_id: string; requester_name: string; placeholder_name: string; created_at: Date }>(
    `select c.id, c.member_id, u.display_name as requester_name, m.display_name as placeholder_name, c.created_at
     from claim_requests c join users u on u.id=c.user_id join members m on m.id=c.member_id
     where c.group_id=$1 and c.status='pending' order by c.created_at`, [groupId]);
}
export async function decideClaim(groupId: string, userId: string, claimId: string, approve: boolean) {
  const me = await requireAdmin(groupId, userId);
  const joinedUser = await tx(async (db) => {
    const c = await q1(`select * from claim_requests where id=$1 and group_id=$2 and status='pending' for update`, [claimId, groupId], db);
    if (!c) throw notFound();
    if (!approve) {
      await db.query(`update claim_requests set status='rejected', decided_by=$2, decided_at=now() where id=$1`, [claimId, me.id]);
      await notify(db, { userId: c.user_id, groupId, type: "claim_rejected", category: "group_activity" });
      await audit(db, { groupId, userId, memberId: me.id, type: "claim.rejected", entityId: claimId });
      return null;
    }
    const u = await q1(`select is_guest from users where id=$1 and deleted_at is null`, [c.user_id], db);
    if (!u) throw notFound();
    if (await q1(`select 1 from members where group_id=$1 and user_id=$2`, [groupId, c.user_id], db)) throw new AppError("already_member");
    const r = await db.query(
      `update members set user_id=$2, role=$3, joined_at=now() where id=$1 and user_id is null and status='active'`, [c.member_id, c.user_id, u.is_guest ? "guest" : "member"]);
    if (!r.rowCount) throw new AppError("target_not_placeholder");
    await db.query(`update claim_requests set status='approved', decided_by=$2, decided_at=now() where id=$1`, [claimId, me.id]);
    await db.query(`update claim_requests set status='rejected', decided_by=$2, decided_at=now() where member_id=$1 and status='pending'`, [c.member_id, me.id]);
    await notify(db, { userId: c.user_id, groupId, type: "claim_approved", category: "group_activity" });
    await audit(db, { groupId, userId, memberId: me.id, type: "claim.approved", entityType: "member", entityId: c.member_id });
    return c.user_id as string;
  });
  if (joinedUser) await track("member_joined", { userId: joinedUser, groupId }, { via: "claim" });
}
