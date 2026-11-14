/**
 * Bölüşme motoru. Saf fonksiyonlar; tüm tutarlar en küçük birimde tam sayı.
 *
 * Yuvarlama kuralı (deterministik, görünür):
 *   Her kişinin payı aşağı yuvarlanır; artan kuruşlar en büyük küsurata sahip
 *   kişilere birer birer verilir. Eşitlikte listedeki sıra (üye sırası) belirler.
 *   Her kişiye düşen yuvarlama farkı `rounding` alanında döner.
 */
export type Share = { memberId: string; amount: number; rounding: number };
export class SplitError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function assertAmount(total: number) {
  if (!Number.isSafeInteger(total) || total < 0) throw new SplitError("invalid_amount");
}

/** total'i ağırlıklarla orantılı dağıtır (en büyük kalan yöntemi). Negatif total desteklenir. */
export function allocateByWeights(total: number, weights: { memberId: string; weight: number }[]): Share[] {
  if (!Number.isSafeInteger(total)) throw new SplitError("invalid_amount");
  if (weights.length === 0) throw new SplitError("no_participants");
  const seen = new Set<string>();
  for (const w of weights) {
    if (!Number.isSafeInteger(w.weight) || w.weight < 0) throw new SplitError("invalid_weight");
    if (seen.has(w.memberId)) throw new SplitError("duplicate_member");
    seen.add(w.memberId);
  }
  const sum = weights.reduce((a, w) => a + BigInt(w.weight), 0n);
  if (sum === 0n) throw new SplitError("zero_weights");
  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));
  const rows = weights.map((w, i) => {
    const num = abs * BigInt(w.weight);
    return { i, memberId: w.memberId, base: num / sum, rem: num % sum };
  });
  let left = Number(abs - rows.reduce((a, r) => a + r.base, 0n));
  const order = [...rows].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const extra = new Map<number, number>();
  for (const r of order) {
    if (left <= 0) break;
    if (r.rem === 0n) break;
    extra.set(r.i, 1);
    left--;
  }
  return rows.map((r) => {
    const e = extra.get(r.i) ?? 0;
    return { memberId: r.memberId, amount: sign * (Number(r.base) + e), rounding: sign * e };
  });
}

export function splitEqual(total: number, memberIds: string[]): Share[] {
  assertAmount(total);
  return allocateByWeights(total, memberIds.map((memberId) => ({ memberId, weight: 1 })));
}

/** Kişiye özel tutar: toplam birebir tutmalı. */
export function splitExact(total: number, parts: { memberId: string; amount: number }[]): Share[] {
  assertAmount(total);
  if (parts.length === 0) throw new SplitError("no_participants");
  const seen = new Set<string>();
  let sum = 0;
  for (const p of parts) {
    if (!Number.isSafeInteger(p.amount) || p.amount < 0) throw new SplitError("invalid_amount");
    if (seen.has(p.memberId)) throw new SplitError("duplicate_member");
    seen.add(p.memberId);
    sum += p.amount;
  }
  if (sum !== total) throw new SplitError("exact_sum_mismatch");
  return parts.map((p) => ({ memberId: p.memberId, amount: p.amount, rounding: 0 }));
}

/** Yüzde: baz puan (1% = 100). Toplam 10000 olmalı. */
export function splitPercent(total: number, parts: { memberId: string; bps: number }[]): Share[] {
  assertAmount(total);
  const sum = parts.reduce((a, p) => a + p.bps, 0);
  if (sum !== 10000) throw new SplitError("percent_sum_mismatch");
  return allocateByWeights(total, parts.map((p) => ({ memberId: p.memberId, weight: p.bps })));
}

/** Pay/ağırlık: ör. 2 pay / 1 pay, veya gün sayısı. */
export function splitShares(total: number, parts: { memberId: string; weight: number }[]): Share[] {
  assertAmount(total);
  return allocateByWeights(total, parts);
}

export type ItemInput = { id: string; amount: number; claims: { memberId: string; weight: number }[] };
export type ItemizedInput = {
  items: ItemInput[];
  discount: number; // pozitif girilir, toplamdan düşer
  service: number;
  tip: number;
  extrasMode: "proportional" | "equal";
};
export type ItemizedResult = {
  total: number;
  shares: Share[];
  perMember: Record<string, { items: number; discount: number; service: number; tip: number }>;
};

/**
 * Fiş kalemleri: her kalem, sahiplenenler arasında ağırlıkla bölünür.
 * İndirim / servis / bahşiş: kalem toplamlarıyla orantılı veya katılanlar arasında eşit dağıtılır.
 */
export function splitItemized(input: ItemizedInput): ItemizedResult {
  const per: ItemizedResult["perMember"] = {};
  const order: string[] = [];
  const get = (id: string) => {
    if (!per[id]) {
      per[id] = { items: 0, discount: 0, service: 0, tip: 0 };
      order.push(id);
    }
    return per[id];
  };
  let itemsTotal = 0;
  for (const it of input.items) {
    assertAmount(it.amount);
    if (it.claims.length === 0) throw new SplitError("unclaimed_item");
    for (const s of allocateByWeights(it.amount, it.claims)) get(s.memberId).items += s.amount;
    itemsTotal += it.amount;
  }
  if (order.length === 0) throw new SplitError("no_participants");
  for (const v of [input.discount, input.service, input.tip]) assertAmount(v);
  if (input.discount > itemsTotal) throw new SplitError("discount_too_large");

  const weightsFor = () => {
    const prop = order.map((memberId) => ({ memberId, weight: per[memberId].items }));
    if (input.extrasMode === "proportional" && itemsTotal > 0) return prop;
    return order.map((memberId) => ({ memberId, weight: 1 }));
  };
  for (const key of ["discount", "service", "tip"] as const) {
    if (input[key] === 0) continue;
    for (const s of allocateByWeights(input[key], weightsFor())) per[s.memberId][key] = s.amount;
  }
  const total = itemsTotal - input.discount + input.service + input.tip;
  let shares = order.map((memberId) => {
    const p = per[memberId];
    return { memberId, amount: p.items - p.discount + p.service + p.tip, rounding: 0 };
  });
  // Eşit dağıtılan indirim, bir kişinin kalem tutarını aşarsa pay eksiye düşmesin:
  // eksiyi sıfırlayıp farkı diğerlerine orantılı yansıt.
  const negative = shares.filter((s) => s.amount < 0);
  if (negative.length) {
    const deficit = negative.reduce((a, s) => a - s.amount, 0);
    const rest = shares.filter((s) => s.amount > 0);
    const cut = allocateByWeights(deficit, rest.map((s) => ({ memberId: s.memberId, weight: s.amount })));
    const cutMap = new Map(cut.map((c) => [c.memberId, c.amount]));
    shares = shares.map((s) => ({ ...s, amount: s.amount < 0 ? 0 : s.amount - (cutMap.get(s.memberId) ?? 0) }));
  }
  return { total, shares, perMember: per };
}

/** Değişmez: payların toplamı harcama tutarına eşit. */
export function assertSharesSum(total: number, shares: { amount: number }[]) {
  const sum = shares.reduce((a, s) => a + s.amount, 0);
  if (sum !== total) throw new SplitError("shares_sum_mismatch");
}

/** İki tarih aralığının (dahil) kesiştiği gün sayısı. Tarihler "YYYY-AA-GG". */
export function overlapDays(aFrom: string, aTo: string, bFrom: string | null, bTo: string | null): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const start = Math.max(d(aFrom), bFrom ? d(bFrom) : -Infinity);
  const end = Math.min(d(aTo), bTo ? d(bTo) : Infinity);
  return end < start ? 0 : Math.round((end - start) / 86_400_000) + 1;
}
