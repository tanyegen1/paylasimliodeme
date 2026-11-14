"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRuleAction, deleteRuleAction, updateRuleAction } from "@/app/actions";
import { ActButton, ErrorText, Field, Sheet, useAct } from "@/components/client";
import { Badge } from "@/components/ui";
import { CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

type M = { id: string; name: string };
type Rule = { id: string; title: string; category: string; amount_minor: number | null; currency: string; payer_member_id: string; frequency: string; next_run: string; prorate_by_days: boolean; active: boolean };
const PRESETS: { title: string; category: Category; variable: boolean }[] = [
  { title: "Kira", category: "rent", variable: false }, { title: "İnternet", category: "internet", variable: false },
  { title: "Elektrik", category: "utilities", variable: true }, { title: "Doğalgaz", category: "utilities", variable: true }, { title: "Su", category: "utilities", variable: true },
];

export function RuleForm({ groupId, members, meId, today, currency }: { groupId: string; members: M[]; meId: string; today: string; currency: string }) {
  const [f, setF] = useState({ title: "", category: "rent" as Category, variable: false, amount: "", payerMemberId: meId, frequency: "monthly", startDate: today, prorateByDays: false });
  const { pending, error, run, setError } = useAct();
  const router = useRouter();
  return (
    <form className="card grid gap-4" onSubmit={(e) => {
      e.preventDefault();
      const amount = f.variable ? null : parseMoney(f.amount);
      if (!f.variable && !amount) return setError(t("errors.amount_required"));
      run(() => createRuleAction(groupId, { ...f, amount }), () => { setF({ ...f, title: "", amount: "" }); router.refresh(); });
    }}>
      <h2>{t("recurring.new")}</h2>
      <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button type="button" key={p.title} className={`chip ${f.title === p.title ? "chip-on" : ""}`} onClick={() => setF({ ...f, title: p.title, category: p.category, variable: p.variable })}><span aria-hidden>{CATEGORY_EMOJI[p.category]}</span>{p.title}</button>)}</div>
      <Field label={t("expense.title")}><input className="input" required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <fieldset className="grid gap-2">
        <legend className="label">{t("recurring.kind")}</legend>
        <label className="flex min-h-[44px] items-start gap-3 text-sm"><input type="radio" name="kind" checked={!f.variable} onChange={() => setF({ ...f, variable: false })} /><span><b>{t("recurring.fixed")}</b><span className="muted block">{t("recurring.fixedBody")}</span></span></label>
        <label className="flex min-h-[44px] items-start gap-3 text-sm"><input type="radio" name="kind" checked={f.variable} onChange={() => setF({ ...f, variable: true })} /><span><b>{t("recurring.variable")}</b><span className="muted block">{t("recurring.variableBody")}</span></span></label>
      </fieldset>
      {!f.variable && <Field label={`${t("expense.amount")} (${currency})`}><input className="input" inputMode="decimal" placeholder="0,00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("expense.paidBy")}><select className="input" value={f.payerMemberId} onChange={(e) => setF({ ...f, payerMemberId: e.target.value })}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label={t("recurring.frequency")}><select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option value="monthly">{t("recurring.monthly")}</option><option value="weekly">{t("recurring.weekly")}</option></select></Field>
      </div>
      <Field label={t("recurring.start")} hint={t("recurring.startHint")}><input className="input" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={f.prorateByDays} onChange={(e) => setF({ ...f, prorateByDays: e.target.checked })} /><span><b>{t("recurring.prorate")}</b><span className="muted block">{t("recurring.prorateBody")}</span></span></label>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" disabled={pending}>{t("recurring.submit")}</button>
    </form>
  );
}

export function RuleRow({ groupId, rule, members, canEdit }: { groupId: string; rule: Rule; members: M[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: rule.title, amount: rule.amount_minor ? minorToInput(rule.amount_minor) : "", payerMemberId: rule.payer_member_id, prorateByDays: rule.prorate_by_days });
  const { pending, error, run } = useAct();
  const router = useRouter();
  const save = (active: boolean) => run(() => updateRuleAction(groupId, rule.id, { title: f.title, amount: f.amount.trim() ? parseMoney(f.amount) : null, payerMemberId: f.payerMemberId, prorateByDays: f.prorateByDays, active }), () => { setOpen(false); router.refresh(); });
  return (
    <li className={`card grid gap-2 ${rule.active ? "" : "opacity-70"}`}>
      <div className="row">
        <p className="font-semibold"><span aria-hidden>{CATEGORY_EMOJI[rule.category as Category] ?? "🧾"}</span> {rule.title}</p>
        <p className="font-bold">{rule.amount_minor ? formatMoney(rule.amount_minor, rule.currency) : <Badge tone="warn">{t("recurring.variableShort")}</Badge>}</p>
      </div>
      <p className="muted text-xs">{rule.frequency === "monthly" ? t("recurring.monthly") : t("recurring.weekly")} · {members.find((m) => m.id === rule.payer_member_id)?.name ?? "?"} · {rule.active ? t("recurring.next", { date: formatDate(rule.next_run) }) : t("recurring.stopped")}{rule.prorate_by_days ? ` · ${t("recurring.prorateShort")}` : ""}</p>
      {canEdit && <button className="btn-secondary btn-sm justify-self-start" onClick={() => setOpen(true)}>{t("common.edit")}</button>}
      <Sheet open={open} onClose={() => setOpen(false)} title={rule.title}>
        <div className="grid gap-4">
          <Field label={t("expense.title")}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={t("expense.amount")} hint={t("recurring.amountHint")}><input className="input" inputMode="decimal" placeholder="0,00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label={t("expense.paidBy")}><select className="input" value={f.payerMemberId} onChange={(e) => setF({ ...f, payerMemberId: e.target.value })}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={f.prorateByDays} onChange={(e) => setF({ ...f, prorateByDays: e.target.checked })} /><span>{t("recurring.prorate")}</span></label>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" disabled={pending} onClick={() => save(true)}>{rule.active ? t("common.save") : t("recurring.resume")}</button>
          {rule.active && <button className="btn-secondary" disabled={pending} onClick={() => save(false)}>{t("recurring.stop")}</button>}
          <ActButton className="btn-danger" label={t("common.delete")} confirm={t("recurring.deleteConfirm")} action={deleteRuleAction.bind(null, groupId, rule.id)} />
          <p className="muted text-xs">{t("recurring.editNote")}</p>
        </div>
      </Sheet>
    </li>
  );
}
