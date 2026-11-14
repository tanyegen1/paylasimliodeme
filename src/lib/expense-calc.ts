/** Harcama girdisinden payları hesaplar. Sunucu ve arayüz önizlemesi aynı kodu kullanır. */
import { z } from "zod";
import { CATEGORIES } from "./categories";
import { CURRENCY_CODES, MAX_MINOR, convertMinor } from "./money";
import { type Share, splitEqual, splitExact, splitItemized, splitPercent, splitShares, assertSharesSum, SplitError } from "./split";

const id = z.string().uuid();
const minor = z.number().int().min(0).max(MAX_MINOR);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z.preprocess((v) => (v === "" || v == null ? null : v), date.nullable()).optional();

export const splitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("equal"), memberIds: z.array(id).min(1).max(100) }),
  z.object({ type: z.literal("exact"), parts: z.array(z.object({ memberId: id, amount: minor })).min(1).max(100) }),
  z.object({ type: z.literal("percent"), parts: z.array(z.object({ memberId: id, bps: z.number().int().min(0).max(10000) })).min(1).max(100) }),
  z.object({ type: z.literal("shares"), parts: z.array(z.object({ memberId: id, weight: z.number().int().min(0).max(100000) })).min(1).max(100) }),
  z.object({
    type: z.literal("itemized"),
    items: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      amount: minor,
      claims: z.array(z.object({ memberId: id, weight: z.number().int().min(1).max(100) })).min(1).max(100),
    })).min(1).max(200),
    discount: minor.default(0), service: minor.default(0), tip: minor.default(0),
    extrasMode: z.enum(["proportional", "equal"]).default("proportional"),
  }),
]);
export type SplitInput = z.infer<typeof splitSchema>;

export const expenseSchema = z.object({
  title: z.string().trim().min(1, "title_required").max(120),
  note: z.string().trim().max(1000).optional().nullable(),
  category: z.enum(CATEGORIES).default("other"),
  amount: minor,
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  expenseDate: date,
  payers: z.array(z.object({ memberId: id, amount: minor })).min(1).max(100),
  split: splitSchema,
  fx: z.object({
    originalAmount: minor, originalCurrency: z.enum(CURRENCY_CODES as [string, ...string[]]),
    rate: z.string().max(20), source: z.string().max(40), date,
  }).optional().nullable(),
  periodStart: optDate, periodEnd: optDate,
  attachmentId: id.optional().nullable(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export function computeShares(total: number, split: SplitInput): Share[] {
  let shares: Share[];
  switch (split.type) {
    case "equal": shares = splitEqual(total, split.memberIds); break;
    case "exact": shares = splitExact(total, split.parts); break;
    case "percent": shares = splitPercent(total, split.parts); break;
    case "shares": shares = splitShares(total, split.parts); break;
    case "itemized": {
      const r = splitItemized({
        items: split.items.map((it, i) => ({ id: String(i), amount: it.amount, claims: it.claims })),
        discount: split.discount, service: split.service, tip: split.tip, extrasMode: split.extrasMode,
      });
      if (r.total !== total) throw new SplitError("itemized_total_mismatch");
      shares = r.shares;
      break;
    }
  }
  assertSharesSum(total, shares);
  return shares;
}

/** Tüm tutarlılık kuralları: ödeyenler toplamı, kur çevirimi, paylar. Hata kodu fırlatır. */
export function validateExpense(input: ExpenseInput): Share[] {
  const seen = new Set<string>();
  let paid = 0;
  for (const p of input.payers) {
    if (seen.has(p.memberId)) throw new SplitError("duplicate_member");
    seen.add(p.memberId);
    paid += p.amount;
  }
  if (paid !== input.amount) throw new SplitError("payers_sum_mismatch");
  if (input.fx) {
    if (input.fx.originalCurrency === input.currency) throw new SplitError("fx_same_currency");
    if (convertMinor(input.fx.originalAmount, input.fx.rate) !== input.amount) throw new SplitError("fx_mismatch");
  }
  if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) throw new SplitError("date_range_invalid");
  return computeShares(input.amount, input.split);
}

export function memberIdsOf(input: ExpenseInput): string[] {
  const s = new Set(input.payers.map((p) => p.memberId));
  const sp = input.split;
  if (sp.type === "equal") sp.memberIds.forEach((m) => s.add(m));
  else if (sp.type === "itemized") sp.items.forEach((it) => it.claims.forEach((c) => s.add(c.memberId)));
  else sp.parts.forEach((p) => s.add(p.memberId));
  return [...s];
}
