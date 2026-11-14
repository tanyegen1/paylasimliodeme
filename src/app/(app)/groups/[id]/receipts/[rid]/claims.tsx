"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { finalizeReceiptAction, receiptToDraftAction, reopenReceiptAction, setClaimAction } from "@/app/actions";
import { ActButton, ErrorText, useAct } from "@/components/client";
import { Badge, Notice } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { firstName } from "@/lib/format";
import { t } from "@/lib/i18n";

type Item = { id: string; name: string; quantity: number; amount: number; uncertain: boolean; claims: string[] };

export function ClaimBoard({ groupId, receiptId, meId, members, canManage, status, currency, items, totals, preview, payerName }: {
  groupId: string; receiptId: string; meId: string; members: { id: string; name: string }[]; canManage: boolean; status: "open" | "finalized" | "draft"; currency: string; items: Item[];
  totals: { items: number; discount: number; service: number; tip: number; total: number; extrasMode: string }; preview: { memberId: string; amount: number }[]; payerName: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useAct();
  const [actingFor, setActingFor] = useState(meId);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const open = status === "open";
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  // Diğer üyelerin seçimleri birkaç saniyede bir yenilenir.
  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 5000);
    return () => clearInterval(i);
  }, [open, router]);
  useEffect(() => setOptimistic({}), [items]);

  const unclaimed = items.filter((i) => i.claims.length === 0);
  const toggle = (it: Item) => {
    const key = `${it.id}:${actingFor}`;
    const on = !(optimistic[key] ?? it.claims.includes(actingFor));
    setOptimistic({ ...optimistic, [key]: on });
    run(() => setClaimAction(groupId, receiptId, it.id, on, actingFor === meId ? null : actingFor), () => router.refresh());
  };
  return (
    <div className="grid gap-4">
      {open && canManage && (
        <label className="block"><span className="label">{t("receipt.actingFor")}</span>
          <select className="input" value={actingFor} onChange={(e) => setActingFor(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.id === meId ? `${m.name} (${t("common.you")})` : m.name}</option>)}</select></label>
      )}
      {open && <p className="muted text-sm">{t("receipt.claimHint")}</p>}
      <ul className="grid gap-2">
        {items.map((it) => {
          const mine = optimistic[`${it.id}:${actingFor}`] ?? it.claims.includes(actingFor);
          const count = it.claims.length + (mine && !it.claims.includes(actingFor) ? 1 : 0) - (!mine && it.claims.includes(actingFor) ? 1 : 0);
          return (
            <li key={it.id}>
              <button type="button" disabled={!open} aria-pressed={mine} onClick={() => toggle(it)}
                className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${mine ? "border-brand-600 bg-brand-50" : "border-paper-line bg-white"}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${mine ? "border-brand-600 bg-brand-600 text-white" : "border-paper-line"}`}>{mine && <Check aria-hidden className="h-4 w-4" strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{it.quantity !== 1 ? `${String(it.quantity).replace(".", ",")} × ` : ""}{it.name}</span>
                  <span className="block text-xs">
                    {it.claims.length === 0 ? <span className="font-semibold text-warm-700">{t("receipt.noOwner")}</span> : <span className="text-ink-mute">{it.claims.map((c) => firstName(name(c))).join(", ")}</span>}
                    {count > 1 && <span className="text-ink-mute"> · {t("receipt.perPerson", { amount: formatMoney(Math.round(it.amount / count), currency) })}</span>}
                  </span>
                </span>
                <span className="text-right font-bold">{formatMoney(it.amount, currency)}{it.uncertain && <span className="block"><Badge tone="warn">{t("receipt.uncertainShort")}</Badge></span>}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>

      <section className="card grid gap-1 text-sm">
        <div className="row"><span>{t("receipt.itemsTotal")}</span><b>{formatMoney(totals.items, currency)}</b></div>
        {totals.discount > 0 && <div className="row"><span>{t("expense.discount")}</span><b>−{formatMoney(totals.discount, currency)}</b></div>}
        {totals.service > 0 && <div className="row"><span>{t("expense.service")}</span><b>{formatMoney(totals.service, currency)}</b></div>}
        {totals.tip > 0 && <div className="row"><span>{t("expense.tip")}</span><b>{formatMoney(totals.tip, currency)}</b></div>}
        <div className="row border-t border-paper-line pt-2 text-base"><span className="font-semibold">{t("receipt.total")}</span><b>{formatMoney(totals.total, currency)}</b></div>
        <p className="muted text-xs">{t("receipt.paidByNote", { name: payerName })} {totals.discount + totals.service + totals.tip > 0 ? (totals.extrasMode === "equal" ? t("expense.extrasEqual") : t("expense.extrasProportional")) : ""}</p>
      </section>

      {preview.length > 0 && (
        <section className="rounded-2xl border border-brand-600/25 bg-brand-50 p-4 text-sm">
          <p className="font-bold text-brand-800">{open ? t("receipt.previewSoFar") : t("expenseDetail.shares")}</p>
          <ul className="mt-2 grid gap-1">{preview.map((p) => <li key={p.memberId} className="row"><span>{name(p.memberId)}{p.memberId === meId ? ` (${t("common.you")})` : ""}</span><b>{formatMoney(p.amount, currency)}</b></li>)}</ul>
          {open && unclaimed.length > 0 && <p className="mt-2 text-xs text-brand-800">{t("receipt.previewNote")}</p>}
        </section>
      )}

      {open && unclaimed.length > 0 && <Notice tone="warn" title={t("receipt.unclaimedTitle", { n: unclaimed.length })}>{unclaimed.map((u) => u.name).join(", ")}</Notice>}
      {open && canManage && (
        <div className="grid gap-2">
          {unclaimed.length === 0 ? (
            <button className="btn-primary" disabled={pending} onClick={() => run(() => finalizeReceiptAction(groupId, receiptId, "block"), (d) => { router.push(`/groups/${groupId}/expenses/${d.expenseId}`); router.refresh(); })}>{t("receipt.finalize")}</button>
          ) : (
            <button className="btn-primary" disabled={pending} onClick={() => { if (window.confirm(t("receipt.splitAllConfirm", { n: unclaimed.length }))) run(() => finalizeReceiptAction(groupId, receiptId, "split_all"), (d) => { router.push(`/groups/${groupId}/expenses/${d.expenseId}`); router.refresh(); }); }}>{t("receipt.finalizeSplitAll")}</button>
          )}
          <ActButton className="btn-secondary" label={t("receipt.backToDraft")} action={receiptToDraftAction.bind(null, groupId, receiptId)} />
          <p className="muted text-xs">{t("receipt.finalizeNote")}</p>
        </div>
      )}
      {open && !canManage && <Notice>{t("receipt.waitFinalize")}</Notice>}
      {status === "finalized" && canManage && <ActButton className="btn-secondary" label={t("receipt.reopen")} confirm={t("receipt.reopenConfirm")} action={reopenReceiptAction.bind(null, groupId, receiptId)} />}
    </div>
  );
}
