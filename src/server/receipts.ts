import "server-only";
import { z } from "zod";
import { q, q1, tx, type Db, pool } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { parse } from "./auth";
import { requireMember, type Member } from "./groups";
import { createExpense } from "./expenses";
import { audit } from "./audit";
import { track } from "./analytics";
import { consumeQuota } from "./entitlements";
import { extractReceipt, ocrStatus } from "./providers/ai";
import { readAttachmentForMember } from "./storage";
import { CURRENCY_CODES, MAX_MINOR } from "@/lib/money";
import { splitItemized, SplitError } from "@/lib/split";

const minor = z.number().int().min(0).max(MAX_MINOR);
const receiptSchema = z.object({
  title: z.string().trim().min(1, "title_required").max(120),
  payerMemberId: z.string().uuid(),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({
    id: z.string().uuid().optional().nullable(),
    name: z.string().trim().min(1, "item_name_required").max(120),
    quantity: z.number().positive().max(9999).default(1),
    amount: minor,
    uncertain: z.boolean().default(false),
  })).min(1, "items_required").max(200),
  declaredTotal: minor.nullable().optional(),
  discount: minor.default(0), service: minor.default(0), tip: minor.default(0),
  extrasMode: z.enum(["proportional", "equal"]).default("proportional"),
  attachmentId: z.string().uuid().nullable().optional(),
  ocrProvider: z.string().max(20).nullable().optional(),
});

export type Receipt = {
  id: string; group_id: string; created_by: string; title: string; status: "draft" | "open" | "finalized"; currency: string; payer_member_id: string;
  expense_date: string; declared_total_minor: number | null; discount_minor: number; service_minor: number; tip_minor: number;
  extras_mode: "proportional" | "equal"; mismatch_ack: boolean; attachment_id: string | null; ocr_provider: string | null; expense_id: string | null;
};

const canManage = (me: Member, r: { created_by: string }) => me.role === "admin" || r.created_by === me.id;

/** Fiş fotoğrafını OCR ile okur. Sonuç KAYDEDİLMEZ; kullanıcı düzenleyip onaylasın diye taslak olarak döner. */
export async function scanReceipt(groupId: string, userId: string, attachmentId: string) {
  await requireMember(groupId, userId);
  if (ocrStatus() === "none") throw new AppError("ocr_unavailable");
  await consumeQuota(userId, groupId, "ocr");
  await track("receipt_scan_started", { userId, groupId }, { provider: ocrStatus() });
  const file = await readAttachmentForMember(groupId, userId, attachmentId);
  return extractReceipt(file.bytes, file.mime);
}

export async function saveReceipt(groupId: string, userId: string, receiptId: string | null, raw: unknown): Promise<string> {
  const me = await requireMember(groupId, userId);
  const input = parse(receiptSchema, raw);
  return tx(async (db) => {
    if (!(await q1(`select 1 from members where id=$1 and group_id=$2 and status='active'`, [input.payerMemberId, groupId], db))) throw new AppError("member_not_in_group");
    if (input.attachmentId && !(await q1(`select 1 from attachments where id=$1 and group_id=$2`, [input.attachmentId, groupId], db))) throw notFound();
    let id = receiptId;
    if (id) {
      const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2 for update`, [id, groupId], db);
      if (!r) throw notFound();
      if (!canManage(me, r)) throw forbidden();
      if (r.status === "finalized") throw new AppError("receipt_finalized");
      await db.query(
        `update receipts set title=$2, payer_member_id=$3, currency=$4, expense_date=$5, declared_total_minor=$6, discount_minor=$7, service_minor=$8, tip_minor=$9, extras_mode=$10, mismatch_ack=false where id=$1`,
        [id, input.title, input.payerMemberId, input.currency, input.expenseDate, input.declaredTotal ?? null, input.discount, input.service, input.tip, input.extrasMode]);
    } else {
      const r = await q1(
        `insert into receipts (group_id, created_by, title, payer_member_id, currency, expense_date, declared_total_minor, discount_minor, service_minor, tip_minor, extras_mode, attachment_id, ocr_provider)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [groupId, me.id, input.title, input.payerMemberId, input.currency, input.expenseDate, input.declaredTotal ?? null, input.discount, input.service, input.tip, input.extrasMode, input.attachmentId ?? null, input.ocrProvider ?? null], db);
      id = r!.id as string;
    }
    // Kalemler: kimliği gelenler güncellenir (seçimler korunur), gelmeyenler silinir, yeniler eklenir.
    const keep = input.items.filter((i) => i.id).map((i) => i.id!);
    await db.query(`delete from receipt_items where receipt_id=$1 and not (id = any($2))`, [id, keep]);
    let pos = 0;
    for (const it of input.items) {
      if (it.id) {
        const u = await db.query(`update receipt_items set name=$3, quantity=$4, amount_minor=$5, uncertain=$6, position=$7 where id=$1 and receipt_id=$2`, [it.id, id, it.name, it.quantity, it.amount, it.uncertain, pos]);
        if (u.rowCount) { pos++; continue; }
      }
      await db.query(`insert into receipt_items (receipt_id, name, quantity, amount_minor, uncertain, position) values ($1,$2,$3,$4,$5,$6)`, [id, it.name, it.quantity, it.amount, it.uncertain, pos++]);
    }
    await audit(db, { groupId, userId, memberId: me.id, type: receiptId ? "receipt.updated" : "receipt.created", entityType: "receipt", entityId: id });
    return id;
  });
}

function totals(r: Receipt, items: { amount_minor: number }[]) {
  const itemsTotal = items.reduce((a, i) => a + i.amount_minor, 0);
  const computed = itemsTotal - r.discount_minor + r.service_minor + r.tip_minor;
  // Fişte yazan toplam bahşişi içermez; karşılaştırma bahşişsiz yapılır.
  const mismatch = r.declared_total_minor != null && r.declared_total_minor !== computed - r.tip_minor ? r.declared_total_minor - (computed - r.tip_minor) : 0;
  return { itemsTotal, computed, mismatch };
}

/** Taslağı üyelerin seçimine açar. Fiş toplamı kalemlerle uyuşmuyorsa açık kullanıcı onayı gerekir. */
export async function openReceipt(groupId: string, userId: string, receiptId: string, ackMismatch: boolean) {
  const me = await requireMember(groupId, userId);
  await tx(async (db) => {
    const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2 for update`, [receiptId, groupId], db);
    if (!r) throw notFound();
    if (!canManage(me, r)) throw forbidden();
    if (r.status !== "draft") return;
    const items = await q<{ amount_minor: number }>(`select amount_minor from receipt_items where receipt_id=$1`, [receiptId], db);
    const t = totals(r, items);
    if (r.discount_minor > t.itemsTotal) throw new AppError("discount_too_large");
    if (t.mismatch !== 0 && !ackMismatch) throw new AppError("receipt_total_mismatch");
    await db.query(`update receipts set status='open', mismatch_ack=$2 where id=$1`, [receiptId, t.mismatch !== 0]);
    await audit(db, { groupId, userId, memberId: me.id, type: "receipt.opened", entityType: "receipt", entityId: receiptId, data: { mismatch_minor: t.mismatch } });
  });
  await track("receipt_scan_confirmed", { userId, groupId }, {});
}
export async function backToDraft(groupId: string, userId: string, receiptId: string) {
  const me = await requireMember(groupId, userId);
  const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2`, [receiptId, groupId]);
  if (!r) throw notFound();
  if (!canManage(me, r)) throw forbidden();
  await q(`update receipts set status='draft' where id=$1 and status='open'`, [receiptId]);
}

/**
 * Kalem seçimi. Her (kalem, üye) ayrı satırdır; iki kişi aynı kalemi aynı anda seçerse
 * ikisi de kaydolur ve kalem aralarında paylaşılır, kimse kimseyi ezmez.
 * Üye yalnızca kendi adına seçer; yönetici/fiş sahibi başkası (ör. geçici üye) adına seçebilir.
 */
export async function setClaim(groupId: string, userId: string, receiptId: string, itemId: string, on: boolean, forMemberId?: string | null, weight = 1) {
  const me = await requireMember(groupId, userId);
  await tx(async (db) => {
    // Paylaşımlı kilit: onay (FOR UPDATE) ile yarışmaz, diğer seçimleri engellemez.
    const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2 for share`, [receiptId, groupId], db);
    if (!r) throw notFound();
    if (r.status !== "open") throw new AppError(r.status === "finalized" ? "receipt_finalized" : "receipt_not_open");
    let target = me.id;
    if (forMemberId && forMemberId !== me.id) {
      if (!canManage(me, r)) throw forbidden();
      if (!(await q1(`select 1 from members where id=$1 and group_id=$2 and status='active'`, [forMemberId, groupId], db))) throw new AppError("member_not_in_group");
      target = forMemberId;
    }
    if (!(await q1(`select 1 from receipt_items where id=$1 and receipt_id=$2`, [itemId, receiptId], db))) throw notFound();
    if (on) {
      await db.query(
        `insert into receipt_claims (item_id, member_id, weight) values ($1,$2,$3) on conflict (item_id, member_id) do update set weight=excluded.weight`,
        [itemId, target, Math.min(Math.max(Math.trunc(weight) || 1, 1), 100)]);
    } else {
      await db.query(`delete from receipt_claims where item_id=$1 and member_id=$2`, [itemId, target]);
    }
  });
}

export async function getReceipt(groupId: string, userId: string, receiptId: string) {
  const me = await requireMember(groupId, userId);
  if (!/^[0-9a-f-]{36}$/i.test(receiptId)) throw notFound();
  const receipt = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2`, [receiptId, groupId]);
  if (!receipt) throw notFound();
  const items = await q<{ id: string; name: string; quantity: string; amount_minor: number; uncertain: boolean; claims: { memberId: string; weight: number }[] }>(
    `select i.id, i.name, i.quantity, i.amount_minor, i.uncertain,
       (select coalesce(json_agg(json_build_object('memberId', c.member_id, 'weight', c.weight) order by c.created_at), '[]') from receipt_claims c where c.item_id=i.id) as claims
     from receipt_items i where i.receipt_id=$1 order by i.position`, [receiptId]);
  const t = totals(receipt, items);
  let preview: { memberId: string; amount: number }[] = [];
  const claimed = items.filter((i) => i.claims.length);
  if (claimed.length) {
    try {
      const claimedTotal = claimed.reduce((a, i) => a + i.amount_minor, 0);
      preview = splitItemized({
        items: claimed.map((i) => ({ id: i.id, amount: i.amount_minor, claims: i.claims })),
        discount: Math.min(receipt.discount_minor, claimedTotal), service: receipt.service_minor, tip: receipt.tip_minor, extrasMode: receipt.extras_mode,
      }).shares;
    } catch { /* önizleme hesaplanamadı */ }
  }
  return { receipt, items, ...t, preview, me, canManage: canManage(me, receipt), unclaimed: items.filter((i) => !i.claims.length).length };
}
export async function listReceipts(groupId: string, userId: string) {
  await requireMember(groupId, userId);
  return q<Receipt & { item_count: number; unclaimed: number }>(
    `select r.*, (select count(*)::int from receipt_items i where i.receipt_id=r.id) as item_count,
       (select count(*)::int from receipt_items i where i.receipt_id=r.id and not exists (select 1 from receipt_claims c where c.item_id=i.id)) as unclaimed
     from receipts r where r.group_id=$1 and r.status <> 'finalized' order by r.created_at desc`, [groupId]);
}

/**
 * Nihai dağılım onayı (fiş sahibi veya yönetici). Fiş kilitlenir, paylar hesaplanır, harcama oluşur.
 * Sahipsiz kalem varsa: "split_all" ile tüm aktif üyelere eşit bölünür, yoksa onay reddedilir.
 */
export async function finalizeReceipt(groupId: string, userId: string, receiptId: string, unclaimed: "block" | "split_all") {
  const me = await requireMember(groupId, userId);
  return tx(async (db) => {
    const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2 for update`, [receiptId, groupId], db);
    if (!r) throw notFound();
    if (!canManage(me, r)) throw forbidden();
    if (r.status === "finalized") throw new AppError("receipt_finalized");
    if (r.status !== "open") throw new AppError("receipt_not_open");
    const items = await q<{ id: string; name: string; amount_minor: number; claims: { memberId: string; weight: number }[] }>(
      `select i.id, i.name, i.amount_minor,
         (select coalesce(json_agg(json_build_object('memberId', c.member_id, 'weight', c.weight) order by c.created_at), '[]') from receipt_claims c where c.item_id=i.id) as claims
       from receipt_items i where i.receipt_id=$1 order by i.position`, [receiptId], db);
    const everyone = (await q<{ id: string }>(`select id from members where group_id=$1 and status='active' order by position, joined_at`, [groupId], db)).map((m) => ({ memberId: m.id, weight: 1 }));
    const filled = items.map((i) => {
      if (i.claims.length) return i;
      if (unclaimed !== "split_all") throw new AppError("receipt_unclaimed_items");
      return { ...i, claims: everyone };
    });
    const split = {
      type: "itemized" as const,
      items: filled.map((i) => ({ name: i.name, amount: i.amount_minor, claims: i.claims })),
      discount: r.discount_minor, service: r.service_minor, tip: r.tip_minor, extrasMode: r.extras_mode,
    };
    let total: number;
    try {
      total = splitItemized({ ...split, items: split.items.map((i, n) => ({ id: String(n), amount: i.amount, claims: i.claims })) }).total;
    } catch (e) {
      throw new AppError(e instanceof SplitError ? e.code : "invalid_input");
    }
    const expenseId = await createExpense(groupId, userId, {
      title: r.title, category: "food", amount: total, currency: r.currency, expenseDate: r.expense_date,
      payers: [{ memberId: r.payer_member_id, amount: total }], split, attachmentId: r.attachment_id,
    }, { db, receiptId, source: "receipt", skipAuth: me });
    await db.query(`update receipts set status='finalized', expense_id=$2, finalized_by=$3, finalized_at=now() where id=$1`, [receiptId, expenseId, me.id]);
    await audit(db, { groupId, userId, memberId: me.id, type: "receipt.finalized", entityType: "receipt", entityId: receiptId, data: { expense_id: expenseId, total_minor: total, unclaimed_policy: unclaimed } });
    return expenseId;
  });
}

/** Onaylanmış fişi yeniden açar: bağlı harcama geri alınabilir biçimde silinir ve değişiklik kayda girer. */
export async function reopenReceipt(groupId: string, userId: string, receiptId: string) {
  const me = await requireMember(groupId, userId);
  await tx(async (db: Db) => {
    const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2 for update`, [receiptId, groupId], db);
    if (!r) throw notFound();
    if (!canManage(me, r)) throw forbidden();
    if (r.status !== "finalized") return;
    if (r.expense_id) await db.query(`update expenses set deleted_at=now(), deleted_by=$2 where id=$1 and deleted_at is null`, [r.expense_id, me.id]);
    await db.query(`update receipts set status='open', expense_id=null, finalized_by=null, finalized_at=null where id=$1`, [receiptId]);
    await audit(db, { groupId, userId, memberId: me.id, type: "receipt.reopened", entityType: "receipt", entityId: receiptId, data: { previous_expense_id: r.expense_id } });
  });
}
export async function deleteReceipt(groupId: string, userId: string, receiptId: string) {
  const me = await requireMember(groupId, userId);
  const r = await q1<Receipt>(`select * from receipts where id=$1 and group_id=$2`, [receiptId, groupId]);
  if (!r) throw notFound();
  if (!canManage(me, r)) throw forbidden();
  if (r.status === "finalized") throw new AppError("receipt_finalized");
  await q(`delete from receipts where id=$1`, [receiptId]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "receipt.deleted", entityType: "receipt", entityId: receiptId });
}
