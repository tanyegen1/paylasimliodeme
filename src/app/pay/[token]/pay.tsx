"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { proposeDateViaLinkAction, reportViaLinkAction, revealIbanAction, startPaymentAction } from "@/app/actions";
import { CopyButton, ErrorText, Field, useAct } from "@/components/client";
import { Badge, Notice } from "@/components/ui";
import { formatIban } from "@/lib/iban";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { formatDate, firstName } from "@/lib/format";
import { t } from "@/lib/i18n";

export function PayClient(p: {
  token: string; currency: string; remaining: number; reported: number; toName: string; hasIban: boolean; failed: boolean;
  provider: { id: string; isDemo: boolean; methods: { id: string; labelKey: string }[]; fee: number } | null; proposedDate: string | null; proposalStatus: string | null;
}) {
  const router = useRouter();
  const { pending, error, run, setError } = useAct();
  const left = p.remaining - p.reported;
  const [iban, setIban] = useState<{ iban: string; holder: string } | null>(null);
  const [amount, setAmount] = useState(minorToInput(Math.max(left, 0)));
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [sent, setSent] = useState(false);
  // Aynı ödeme denemesi için tek anahtar: çift tıklama ya da yeniden gönderim ikinci ödeme oluşturmaz.
  const idem = useMemo(() => `pay-${crypto.randomUUID()}`, []);
  const minor = parseMoney(amount);
  const to = firstName(p.toName);

  return (
    <div className="grid gap-4">
      {p.failed && <Notice tone="warn" title={t("pay.failedTitle")}>{t("pay.failedBody")}</Notice>}
      {p.reported > 0 && <Notice title={t("payLabel.reported")}>{t("pay.reportedBody", { amount: formatMoney(p.reported, p.currency), to })}</Notice>}
      {sent && <Notice tone="ok" title={t("pay.sentTitle")}>{t("pay.sentBody", { to })}</Notice>}

      {left > 0 && p.provider && (
        <section className="card grid gap-3">
          <div className="row"><h2>{t("pay.withProvider")}</h2>{p.provider.isDemo && <Badge tone="warn">DEMO</Badge>}</div>
          {p.provider.isDemo && <p className="text-sm text-warm-700">{t("pay.sandboxWarn")}</p>}
          <ul className="grid gap-1 text-sm">
            <li className="row"><span>{t("pay.amount")}</span><b>{formatMoney(left, p.currency)}</b></li>
            <li className="row"><span>{t("pay.fee")}</span><b>{formatMoney(p.provider.fee, p.currency)}</b></li>
            <li className="row border-t border-paper-line pt-1 text-base"><span className="font-semibold">{t("pay.total")}</span><b>{formatMoney(left + p.provider.fee, p.currency)}</b></li>
          </ul>
          <p className="muted text-xs">{t("pay.methods")}: {p.provider.methods.map((m) => t(m.labelKey as "pay.methodSandbox")).join(", ")}</p>
          <button className="btn-primary" disabled={pending} onClick={() => run(() => startPaymentAction(p.token, { amount: left, idempotencyKey: idem }), (d) => { window.location.href = d.redirectUrl; })}>{t("pay.goProvider")}</button>
          <p className="muted text-xs">{t("pay.providerNote")}</p>
        </section>
      )}

      {left > 0 && (
        <section className="card grid gap-3">
          <h2>{p.provider ? t("pay.orManual") : t("pay.manualTitle")}</h2>
          {!p.provider && <p className="muted">{t("pay.manualLead", { to })}</p>}
          {p.hasIban ? (
            iban ? (
              <div className="grid gap-2 rounded-xl bg-paper p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">{t("pay.recipient")}</p>
                <p className="font-semibold">{iban.holder}</p>
                <p className="break-all font-mono text-[15px]">{formatIban(iban.iban)}</p>
                <div className="flex flex-wrap gap-2"><CopyButton text={iban.iban} label={t("pay.copyIban")} /><CopyButton text={minorToInput(left)} label={t("pay.copyAmount")} /></div>
                <p className="muted text-xs">{t("pay.ibanNote")}</p>
              </div>
            ) : <button className="btn-secondary" disabled={pending} onClick={() => run(() => revealIbanAction(p.token), (d) => setIban(d))}>{t("pay.showIban", { to })}</button>
          ) : <Notice>{t("pay.noIban", { to })}</Notice>}

          <form className="grid gap-3 border-t border-paper-line pt-3" onSubmit={(e) => {
            e.preventDefault();
            if (!minor) return setError(t("errors.amount_required"));
            run(() => reportViaLinkAction(p.token, { amount: minor, note }), () => { setSent(true); router.refresh(); });
          }}>
            <p className="text-sm font-semibold">{t("pay.afterTransfer")}</p>
            <Field label={t("pay.paidAmount", { currency: p.currency })} hint={t("settle.partialHint")}><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label={t("pay.noteOptional")}><input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <button className="btn-primary" disabled={pending}>{t("pay.iPaid")}</button>
            <p className="muted text-xs">{t("pay.reportNote", { to })}</p>
          </form>
        </section>
      )}
      <ErrorText>{error}</ErrorText>

      {left > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">{t("pay.proposeTitle")}</summary>
          {p.proposedDate && p.proposalStatus && <p className="mt-3 text-sm">{t(`pay.proposal_${p.proposalStatus}` as "pay.proposal_pending", { date: formatDate(p.proposedDate), to })}</p>}
          <form className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => proposeDateViaLinkAction(p.token, date), () => router.refresh()); }}>
            <Field label={t("pay.proposeDate")} hint={t("pay.proposeHint", { to })}><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <button className="btn-secondary" disabled={pending}>{t("pay.proposeSubmit")}</button>
          </form>
        </details>
      )}
    </div>
  );
}
