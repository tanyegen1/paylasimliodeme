import "server-only";
import { q, type Db, pool } from "./db";
import { requireMember, listGroups, type Member } from "./groups";
import { computeNets, pairwiseDebts, simplifyDebts, type LedgerExpense, type LedgerPayment, type Transfer, type NetMap } from "@/lib/balances";

/** Bakiyenin tek kaynağı: etkin (silinmemiş, taslak olmayan) harcamalar + geri alınmamış kesin ödemeler. */
export async function loadLedger(groupId: string, db: Db = pool): Promise<{ expenses: LedgerExpense[]; payments: LedgerPayment[] }> {
  const rows = await q(
    `select e.id, e.currency,
       (select coalesce(json_agg(json_build_object('memberId', p.member_id, 'amount', p.amount_minor)), '[]') from expense_payers p where p.expense_id=e.id) as payers,
       (select coalesce(json_agg(json_build_object('memberId', a.member_id, 'amount', a.amount_minor)), '[]') from expense_allocations a where a.expense_id=e.id) as allocations
     from expenses e where e.group_id=$1 and e.deleted_at is null and e.status='active' order by e.created_at, e.id`, [groupId], db);
  const pays = await q(
    `select id, currency, from_member as "from", to_member as "to", amount_minor as amount from payments where group_id=$1 and reversed_at is null order by created_at, id`, [groupId], db);
  return { expenses: rows as LedgerExpense[], payments: pays as LedgerPayment[] };
}

function remap(ledger: { expenses: LedgerExpense[]; payments: LedgerPayment[] }, units: Record<string, string>) {
  const u = (id: string) => units[id] ?? id;
  const merge = (xs: { memberId: string; amount: number }[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(u(x.memberId), (m.get(u(x.memberId)) ?? 0) + x.amount);
    return [...m].map(([memberId, amount]) => ({ memberId, amount }));
  };
  return {
    expenses: ledger.expenses.map((e) => ({ ...e, payers: merge(e.payers), allocations: merge(e.allocations) })),
    payments: ledger.payments.filter((p) => u(p.from) !== u(p.to)).map((p) => ({ ...p, from: u(p.from), to: u(p.to) })),
  };
}

export type GroupBalances = {
  nets: NetMap;                 // kişi bazında, para birimi bazında
  transfers: Transfer[];        // önerilen hesaplaşma planı (kesin ödeme değildir)
  units: Record<string, string>; // çift: üye → temsilci
  currencies: string[];
  simplified: boolean;
};

export async function computeGroupBalances(groupId: string, db: Db = pool): Promise<GroupBalances> {
  const ledger = await loadLedger(groupId, db);
  const g = (await q(`select simplify_debts from groups where id=$1`, [groupId], db))[0];
  const members = await q<{ id: string }>(`select id from members where group_id=$1 order by position, joined_at`, [groupId], db);
  const couples = await q(`select member_a, member_b from couple_links where group_id=$1 and status='accepted'`, [groupId], db);
  const units: Record<string, string> = {};
  for (const c of couples) units[c.member_b] = c.member_a;
  const nets = computeNets(ledger.expenses, ledger.payments);
  const merged = remap(ledger, units);
  const mergedNets = computeNets(merged.expenses, merged.payments);
  const order = members.map((m) => m.id);
  const transfers: Transfer[] = [];
  const currencies = Object.keys(nets).sort((a, b) => (a === "TRY" ? -1 : b === "TRY" ? 1 : a.localeCompare(b)));
  for (const cur of currencies) {
    transfers.push(...(g.simplify_debts ? simplifyDebts(mergedNets[cur] ?? {}, cur, order) : pairwiseDebts(merged.expenses, merged.payments, cur)));
  }
  return { nets, transfers, units, currencies, simplified: g.simplify_debts };
}

export async function getGroupBalances(groupId: string, userId: string) {
  await requireMember(groupId, userId);
  return computeGroupBalances(groupId);
}

/** Bir üyenin bakiyesini oluşturan tüm kalemler: açıklanabilirlik. */
export async function explainMember(groupId: string, userId: string, memberId: string) {
  await requireMember(groupId, userId);
  const expenses = await q<{ id: string; title: string; expense_date: string; currency: string; amount_minor: number; paid: number; share: number }>(
    `select e.id, e.title, e.expense_date, e.currency, e.amount_minor,
       coalesce((select amount_minor from expense_payers p where p.expense_id=e.id and p.member_id=$2),0) as paid,
       coalesce((select amount_minor from expense_allocations a where a.expense_id=e.id and a.member_id=$2),0) as share
     from expenses e where e.group_id=$1 and e.deleted_at is null and e.status='active'
       and (exists (select 1 from expense_payers p where p.expense_id=e.id and p.member_id=$2) or exists (select 1 from expense_allocations a where a.expense_id=e.id and a.member_id=$2))
     order by e.expense_date desc, e.created_at desc`, [groupId, memberId]);
  const payments = await q<{ id: string; from_member: string; to_member: string; amount_minor: number; currency: string; source: string; created_at: Date }>(
    `select id, from_member, to_member, amount_minor, currency, source, created_at from payments
     where group_id=$1 and reversed_at is null and (from_member=$2 or to_member=$2) order by created_at desc`, [groupId, memberId]);
  return { expenses, payments };
}

/** Ana sayfa: para birimi bazında toplam alacak / borç. Para birimleri birbirine çevrilip TOPLANMAZ. */
export async function getHomeSummary(userId: string) {
  const groups = await listGroups(userId);
  const totals: Record<string, { owed: number; owe: number }> = {};
  const perGroup: Record<string, Record<string, number>> = {};
  for (const g of groups) {
    if (g.archived_at) continue;
    const { nets } = await computeGroupBalances(g.id);
    perGroup[g.id] = {};
    for (const [cur, byMember] of Object.entries(nets)) {
      const v = byMember[g.my_member_id] ?? 0;
      if (v === 0) continue;
      perGroup[g.id][cur] = v;
      const t = (totals[cur] ??= { owed: 0, owe: 0 });
      if (v > 0) t.owed += v;
      else t.owe += -v;
    }
  }
  return { groups, totals, perGroup };
}

export function memberName(members: Pick<Member, "id" | "display_name">[], id: string) {
  return members.find((m) => m.id === id)?.display_name ?? "?";
}
