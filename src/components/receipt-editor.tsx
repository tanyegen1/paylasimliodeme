"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Plus, Trash2 } from "lucide-react";
import { openReceiptAction, saveReceiptAction, scanReceiptAction, deleteReceiptAction } from "@/app/actions";
import { ActButton, ErrorText, Field, useAct } from "@/components/client";
import { Notice, Badge } from "@/components/ui";
import { CURRENCY_CODES, formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { t } from "@/lib/i18n";

type Row = { id?: string; name: string; quantity: string; amount: string; uncertain: boolean };
export type ReceiptInitial = { id: string; title: string; payerMemberId: string; currency: string; expenseDate: string; items: Row[]; declaredTotal: string; discount: string; service: string; tip: string; extrasMode: "proportional" | "equal" };
const m = (s: string) => parseMoney(s) ?? 0;

export function ReceiptEditor({ groupId, members, meId, groupCurrency, today, ocr, initial }: {
  groupId: string; members: { id: string; name: string }[]; meId: string; groupCurrency: string; today: string; ocr: "none" | "demo" | "anthropic"; initial?: ReceiptInitial;
}) {
  const router = useRouter();
  const { pending, error, run, setError } = useAct();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<Omit<ReceiptInitial, "id" | "items">>(initial ?? { title: "", payerMemberId: meId, currency: groupCurrency, expenseDate: today, declaredTotal: "", discount: "", service: "", tip: "", extrasMode: "proportional" });
  const [items, setItems] = useState<Row[]>(initial?.items ?? [{ name: "", quantity: "1", amount: "", uncertain: false }]);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [ocrProvider, setOcrProvider] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ack, setAck] = useState(false);

  const itemsTotal = items.reduce((a, it) => a + m(it.amount), 0);
  const computed = itemsTotal - m(f.discount) + m(f.service);
  const declared = f.declaredTotal.trim() ? m(f.declaredTotal) : null;
  const mismatch = declared != null && declared !== computed ? declared - computed : 0;
  const uncertain = items.filter((i) => i.uncertain).length;
  const upd = (idx: number, patch: Partial<Row>) => setItems(items.map((x, j) => (j === idx ? { ...x, ...patch } : x)));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file); fd.set("groupId", groupId); fd.set("kind", "receipt");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) return setError(j.error ?? t("errors.generic"));
      setAttachmentId(j.id);
      if (ocr !== "none") {
        run(() => scanReceiptAction(groupId, j.id), (d) => {
          setOcrProvider(d.provider);
          setItems(d.items.map((i) => ({ name: i.name, quantity: String(i.quantity).replace(".", ","), amount: minorToInput(i.amountMinor), uncertain: i.uncertain })));
          setF((p) => ({ ...p, title: p.title || d.merchant || "", discount: d.discountMinor ? minorToInput(d.discountMinor) : "", service: d.serviceMinor ? minorToInput(d.serviceMinor) : "", declaredTotal: d.totalMinor != null ? minorToInput(d.totalMinor) : "" }));
        });
      }
    } catch { setError(t("errors.network")); } finally { setUploading(false); }
  };

  const payload = () => ({
    ...f, declaredTotal: declared, discount: m(f.discount), service: m(f.service), tip: m(f.tip), attachmentId, ocrProvider,
    items: items.filter((i) => i.name.trim() || m(i.amount) > 0).map((i) => ({ id: i.id ?? null, name: i.name.trim() || t("expense.itemDefault"), quantity: Number(i.quantity.replace(",", ".")) || 1, amount: m(i.amount), uncertain: i.uncertain })),
  });
  const save = (open: boolean) => {
    if (open && mismatch !== 0 && !ack) return setError(t("errors.receipt_total_mismatch"));
    run(() => saveReceiptAction(groupId, initial?.id ?? null, payload()), (d) => {
      if (!open) { router.push(`/groups/${groupId}/receipts/${d.id}`); router.refresh(); return; }
      run(() => openReceiptAction(groupId, d.id, ack), () => { router.push(`/groups/${groupId}/receipts/${d.id}`); router.refresh(); });
    });
  };

  return (
    <div className="grid gap-5">
      <div className="card grid gap-3">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label={t("receipt.photo")} onChange={(e) => onFile(e.target.files?.[0])} />
        <button type="button" className="btn-secondary" disabled={uploading || pending} onClick={() => fileRef.current?.click()}><Camera aria-hidden className="h-5 w-5" />{uploading ? t("receipt.uploading") : pending && attachmentId ? t("receipt.reading") : attachmentId ? t("receipt.photoChange") : t("receipt.photo")}</button>
        {ocr === "none" && <p className="muted text-xs">{t("receipt.ocrNone")}</p>}
        {ocr === "demo" && <Notice tone="warn">{t("receipt.ocrDemo")}</Notice>}
        {ocrProvider && <Notice tone="ok">{t("receipt.ocrDone")}{uncertain > 0 ? ` ${t("receipt.ocrUncertain", { n: uncertain })}` : ""}</Notice>}
      </div>

      <Field label={t("receipt.title")}><input className="input" required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("receipt.titlePh")} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("expense.paidBy")}><select className="input" value={f.payerMemberId} onChange={(e) => setF({ ...f, payerMemberId: e.target.value })}>{members.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label={t("expense.date")}><input className="input" type="date" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></Field>
      </div>

      <section className="grid gap-2">
        <h2 className="text-sm font-bold">{t("receipt.items")}</h2>
        {items.map((it, idx) => (
          <div key={idx} className={`grid gap-2 rounded-xl border bg-white p-2.5 ${it.uncertain ? "border-warm-600/50" : "border-paper-line"}`}>
            <div className="grid grid-cols-[1fr_3.5rem_6.5rem_auto] gap-1.5">
              <input className="input !min-h-[44px]" aria-label={t("expense.itemName")} placeholder={t("expense.itemName")} maxLength={120} value={it.name} onChange={(e) => upd(idx, { name: e.target.value })} />
              <input className="input !min-h-[44px] px-2 text-center" aria-label={t("receipt.qty")} inputMode="decimal" value={it.quantity} onChange={(e) => upd(idx, { quantity: e.target.value })} />
              <input className="input !min-h-[44px] text-right" aria-label={t("expense.itemAmount")} inputMode="decimal" placeholder="0,00" value={it.amount} onChange={(e) => upd(idx, { amount: e.target.value })} />
              <button type="button" className="grid w-9 place-items-center text-ink-mute" aria-label={t("expense.itemRemove")} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== idx))}><Trash2 aria-hidden className="h-4 w-4" /></button>
            </div>
            {it.uncertain && (
              <div className="row text-xs text-warm-700"><span className="flex items-center gap-1 font-semibold"><AlertTriangle aria-hidden className="h-4 w-4" />{t("receipt.uncertain")}</span>
                <button type="button" className="font-semibold underline" onClick={() => upd(idx, { uncertain: false })}>{t("receipt.markOk")}</button></div>
            )}
          </div>
        ))}
        <button type="button" className="btn-secondary btn-sm justify-self-start" onClick={() => setItems([...items, { name: "", quantity: "1", amount: "", uncertain: false }])}><Plus aria-hidden className="h-4 w-4" />{t("expense.itemAdd")}</button>
      </section>

      <div className="grid grid-cols-3 gap-2">
        {(["discount", "service", "tip"] as const).map((k) => <Field key={k} label={t(`expense.${k}`)}><input className="input" inputMode="decimal" placeholder="0,00" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
      </div>
      <Field label={t("expense.extrasMode")}><select className="input" value={f.extrasMode} onChange={(e) => setF({ ...f, extrasMode: e.target.value as "proportional" | "equal" })}><option value="proportional">{t("expense.extrasProportional")}</option><option value="equal">{t("expense.extrasEqual")}</option></select></Field>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field label={t("receipt.declared")} hint={t("receipt.declaredHint")}><input className="input" inputMode="decimal" placeholder="0,00" value={f.declaredTotal} onChange={(e) => setF({ ...f, declaredTotal: e.target.value })} /></Field>
        <Field label={t("expense.currency")}><select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>

      <section className="card grid gap-1 text-sm" aria-live="polite">
        <div className="row"><span>{t("receipt.itemsTotal")}</span><b>{formatMoney(itemsTotal, f.currency)}</b></div>
        <div className="row"><span>{t("receipt.computed")}</span><b>{formatMoney(computed, f.currency)}</b></div>
        {m(f.tip) > 0 && <div className="row"><span>{t("receipt.withTip")}</span><b>{formatMoney(computed + m(f.tip), f.currency)}</b></div>}
        {mismatch !== 0 && (
          <div className="mt-2 grid gap-2 rounded-xl border border-warm-600/40 bg-warm-50 p-3 text-warm-700">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle aria-hidden className="h-4 w-4" />{t("receipt.mismatch", { diff: formatMoney(Math.abs(mismatch), f.currency) })}</p>
            <label className="flex items-start gap-3"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{t("receipt.mismatchAck", { amount: formatMoney(computed + m(f.tip), f.currency) })}</span></label>
          </div>
        )}
        {uncertain > 0 && <p className="mt-1"><Badge tone="warn">{t("receipt.uncertainCount", { n: uncertain })}</Badge></p>}
      </section>

      <ErrorText>{error}</ErrorText>
      <button type="button" className="btn-primary" disabled={pending || uploading || (mismatch !== 0 && !ack)} onClick={() => save(true)}>{t("receipt.openForClaims")}</button>
      <button type="button" className="btn-secondary" disabled={pending || uploading} onClick={() => save(false)}>{t("receipt.saveDraft")}</button>
      {initial && <ActButton className="btn-danger" label={t("receipt.delete")} confirm={t("receipt.deleteConfirm")} action={deleteReceiptAction.bind(null, groupId, initial.id)} href={`/groups/${groupId}`} />}
      <p className="muted text-xs">{t("receipt.flowNote")}</p>
    </div>
  );
}
