/**
 * Bakiye ve hesaplaşma hesapları. Saf fonksiyonlar.
 * Net bakiye > 0: alacaklı. Net bakiye < 0: borçlu.
 */
import { allocateByWeights } from "./split";

export type LedgerExpense = {
  id: string;
  currency: string;
  payers: { memberId: string; amount: number }[];
  allocations: { memberId: string; amount: number }[];
};
export type LedgerPayment = { id: string; currency: string; from: string; to: string; amount: number };
export type Transfer = { from: string; to: string; amount: number; currency: string };
/** currency → memberId → net */
export type NetMap = Record<string, Record<string, number>>;

export function computeNets(expenses: LedgerExpense[], payments: LedgerPayment[]): NetMap {
  const nets: NetMap = {};
  const add = (cur: string, m: string, v: number) => {
    (nets[cur] ??= {})[m] = (nets[cur][m] ?? 0) + v;
  };
  for (const e of expenses) {
    for (const p of e.payers) add(e.currency, p.memberId, p.amount);
    for (const a of e.allocations) add(e.currency, a.memberId, -a.amount);
  }
  for (const p of payments) {
    add(p.currency, p.from, p.amount);
    add(p.currency, p.to, -p.amount);
  }
  return nets;
}

/**
 * Birlikte hesaplaşan çiftler: iki üyenin neti tek birimde toplanır.
 * `units`: memberId → temsilci memberId.
 */
export function mergeUnits(nets: Record<string, number>, units: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [m, v] of Object.entries(nets)) {
    const u = units[m] ?? m;
    out[u] = (out[u] ?? 0) + v;
  }
  return out;
}

/**
 * Sadeleştirme: en büyük borçluyu en büyük alacaklıyla eşleştiren açgözlü yöntem.
 * En fazla (kişi sayısı − 1) transfer üretir, net bakiyeleri değiştirmez.
 * Matematiksel olarak en az transferi GARANTİ ETMEZ.
 */
export function simplifyDebts(nets: Record<string, number>, currency: string, order: string[] = []): Transfer[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const byRank = (a: string, b: string) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b);
  const debtors = Object.entries(nets).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = Object.entries(nets).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const sort = (xs: { id: string; v: number }[]) => xs.sort((a, b) => b.v - a.v || byRank(a.id, b.id));
  const out: Transfer[] = [];
  sort(debtors);
  sort(creditors);
  while (debtors.length && creditors.length) {
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount: amt, currency });
    d.v -= amt;
    c.v -= amt;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
    sort(debtors);
    sort(creditors);
  }
  return out;
}

/**
 * Sadeleştirme kapalıyken: borçlar harcamalardaki gerçek "kim kimin yerine ödedi" ilişkisinden
 * çıkarılır, yalnızca aynı iki kişi arasındaki karşılıklı borçlar netleştirilir.
 */
export function pairwiseDebts(expenses: LedgerExpense[], payments: LedgerPayment[], currency: string): Transfer[] {
  const owes = new Map<string, number>(); // "borçlu|alacaklı" → tutar
  const add = (from: string, to: string, v: number) => {
    if (from === to || v === 0) return;
    owes.set(`${from}|${to}`, (owes.get(`${from}|${to}`) ?? 0) + v);
  };
  for (const e of expenses) {
    if (e.currency !== currency) continue;
    // Harcama içi net: herkesin kendi ödediği önce kendi payını karşılar.
    const net = new Map<string, number>();
    for (const p of e.payers) net.set(p.memberId, (net.get(p.memberId) ?? 0) + p.amount);
    for (const al of e.allocations) net.set(al.memberId, (net.get(al.memberId) ?? 0) - al.amount);
    const creditors = [...net].filter(([, v]) => v > 0).map(([memberId, v]) => ({ memberId, left: v }));
    const debtors = [...net].filter(([, v]) => v < 0).map(([memberId, v]) => ({ memberId, owes: -v }));
    // Her borçlunun borcu, alacaklıların KALAN alacağıyla orantılı dağıtılır: kuruşu kuruşuna tutar.
    for (const d of debtors) {
      const open = creditors.filter((c) => c.left > 0);
      if (!open.length) break;
      for (const part of allocateByWeights(d.owes, open.map((c) => ({ memberId: c.memberId, weight: c.left })))) {
        add(d.memberId, part.memberId, part.amount);
        open.find((c) => c.memberId === part.memberId)!.left -= part.amount;
      }
    }
  }
  for (const p of payments) if (p.currency === currency) add(p.to, p.from, p.amount);
  const out: Transfer[] = [];
  const done = new Set<string>();
  for (const key of owes.keys()) {
    const [a, b] = key.split("|");
    const pair = [a, b].sort().join("|");
    if (done.has(pair)) continue;
    done.add(pair);
    const net = (owes.get(`${a}|${b}`) ?? 0) - (owes.get(`${b}|${a}`) ?? 0);
    if (net > 0) out.push({ from: a, to: b, amount: net, currency });
    else if (net < 0) out.push({ from: b, to: a, amount: -net, currency });
  }
  return out.sort((x, y) => y.amount - x.amount || x.from.localeCompare(y.from));
}

/** Transferlerin ima ettiği net bakiyeler (sadeleştirme değişmezini sınamak için). */
export function netsFromTransfers(transfers: Transfer[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of transfers) {
    out[t.from] = (out[t.from] ?? 0) - t.amount;
    out[t.to] = (out[t.to] ?? 0) + t.amount;
  }
  return out;
}
