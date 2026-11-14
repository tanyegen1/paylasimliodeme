"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { prorationAction, saveExpenseAction, suggestRateAction } from "@/app/actions";
import { ErrorText, Field, useAct } from "@/components/client";
import { Notice } from "@/components/ui";
import { CATEGORIES_BY_TYPE, CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { CURRENCY_CODES, convertMinor, formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { computeShares, type ExpenseInput, type SplitInput } from "@/lib/expense-calc";
import { SplitError } from "@/lib/split";
import { t, tDyn } from "@/lib/i18n";

type M = { id: string; name: string };
type SplitType = SplitInput["type"];
type Item = { name: string; amount: string; members: string[] };
export type ExpenseInitial = { id: string; version: number; isDraft: boolean; input: ExpenseInput };

const money = (s: string) => parseMoney(s) ?? 0;

export function ExpenseForm({ groupId, groupType, groupCurrency, members, meId, today, initial, fxEnabled }: {
  groupId: string; groupType: string; groupCurrency: string; members: M[]; meId: string; today: string; initial?: ExpenseInitial; fxEnabled: boolean;
}) {
  const router = useRouter();
  const { pending, error, run, setError } = useAct();
  const i = initial?.input;
  const all = members.map((m) => m.id);
  const sp = i?.split;

  const [title, setTitle] = useState(i?.title ?? "");
  const [category, setCategory] = useState<Category>(i?.category ?? CATEGORIES_BY_TYPE[groupType]?.[0] ?? "other");
  const [amount, setAmount] = useState(i ? (i.fx ? minorToInput(i.fx.originalAmount) : i.amount ? minorToInput(i.amount) : "") : "");
  const [currency, setCurrency] = useState(i?.fx?.originalCurrency ?? i?.currency ?? groupCurrency);
  const [date, setDate] = useState(i?.expenseDate ?? today);
  const [note, setNote] = useState(i?.note ?? "");
  const [convert, setConvert] = useState(!!i?.fx);
  const [rate, setRate] = useState(i?.fx?.rate ?? "");
  const [rateSource, setRateSource] = useState(i?.fx?.source ?? t("expense.rateManual"));
  const [rateDate, setRateDate] = useState(i?.fx?.date ?? today);
  const [multiPayer, setMultiPayer] = useState((i?.payers.length ?? 1) > 1);
  const [payer, setPayer] = useState(i?.payers[0]?.memberId ?? meId);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(Object.fromEntries((i?.payers ?? []).map((p) => [p.memberId, minorToInput(p.amount)])));
  const [type, setType] = useState<SplitType>(sp?.type ?? "equal");
  const [included, setIncluded] = useState<string[]>(sp?.type === "equal" ? sp.memberIds : sp && sp.type !== "itemized" ? sp.parts.map((p) => p.memberId) : all);
  const [exact, setExact] = useState<Record<string, string>>(sp?.type === "exact" ? Object.fromEntries(sp.parts.map((p) => [p.memberId, minorToInput(p.amount)])) : {});
  const [percent, setPercent] = useState<Record<string, string>>(sp?.type === "percent" ? Object.fromEntries(sp.parts.map((p) => [p.memberId, String(p.bps / 100).replace(".", ",")])) : {});
  const [weights, setWeights] = useState<Record<string, string>>(sp?.type === "shares" ? Object.fromEntries(sp.parts.map((p) => [p.memberId, String(p.weight)])) : {});
  const [items, setItems] = useState<Item[]>(sp?.type === "itemized" ? sp.items.map((it) => ({ name: it.name, amount: minorToInput(it.amount), members: it.claims.map((c) => c.memberId) })) : [{ name: "", amount: "", members: all }]);
  const [extras, setExtras] = useState({ discount: sp?.type === "itemized" ? minorToInput(sp.discount) : "", service: sp?.type === "itemized" ? minorToInput(sp.service) : "", tip: sp?.type === "itemized" ? minorToInput(sp.tip) : "", mode: sp?.type === "itemized" ? sp.extrasMode : ("proportional" as const) });
  const [period, setPeriod] = useState({ on: !!i?.periodStart, from: i?.periodStart ?? "", to: i?.periodEnd ?? "" });
  const [prorated, setProrated] = useState(false);

  const foreign = currency !== groupCurrency;
  const fxOn = foreign && convert;
  const ledgerCurrency = fxOn ? groupCurrency : currency;

  const built = useMemo((): { input?: ExpenseInput; shares?: { memberId: string; amount: number; rounding: number }[]; problem?: string } => {
    let split: SplitInput;
    const inc = members.filter((m) => included.includes(m.id)).map((m) => m.id);
    const itemsTotal = items.reduce((a, it) => a + money(it.amount), 0);
    const entered = type === "itemized" ? itemsTotal - money(extras.discount) + money(extras.service) + money(extras.tip) : money(amount);
    if (entered <= 0) return { problem: t("expense.needAmount") };
    let total = entered;
    if (fxOn) {
      const c = convertMinor(entered, rate || "x");
      if (c == null || c <= 0) return { problem: t("expense.needRate") };
      total = c;
    }
    if (type === "equal") split = { type, memberIds: inc };
    else if (type === "exact") split = { type, parts: inc.map((memberId) => ({ memberId, amount: money(exact[memberId] ?? "") })) };
    else if (type === "percent") split = { type, parts: inc.map((memberId) => ({ memberId, bps: Math.round(Number((percent[memberId] ?? "0").replace(",", ".")) * 100) || 0 })) };
    else if (type === "shares") split = { type, parts: inc.map((memberId) => ({ memberId, weight: Math.max(0, Math.trunc(Number(weights[memberId] ?? "1")) || 0) })) };
    else {
      if (fxOn) return { problem: t("expense.itemizedNoFx") };
      split = { type, items: items.filter((it) => money(it.amount) > 0).map((it) => ({ name: it.name.trim() || t("expense.itemDefault"), amount: money(it.amount), claims: members.filter((m) => it.members.includes(m.id)).map((m) => ({ memberId: m.id, weight: 1 })) })), discount: money(extras.discount), service: money(extras.service), tip: money(extras.tip), extrasMode: extras.mode };
      if (split.items.some((it) => !it.claims.length)) return { problem: t("errors.unclaimed_item") };
    }
    if (type !== "itemized" && !inc.length) return { problem: t("errors.no_participants") };
    const payers = multiPayer ? members.map((m) => ({ memberId: m.id, amount: money(payerAmounts[m.id] ?? "") })).filter((p) => p.amount > 0) : [{ memberId: payer, amount: total }];
    if (multiPayer && payers.reduce((a, p) => a + p.amount, 0) !== total) return { problem: t("expense.payersLeft", { amount: formatMoney(total - payers.reduce((a, p) => a + p.amount, 0), ledgerCurrency) }) };
    try {
      const shares = computeShares(total, split);
      const input: ExpenseInput = {
        title: title.trim(), note: note.trim() || null, category, amount: total, currency: ledgerCurrency, expenseDate: date, payers, split,
        fx: fxOn ? { originalAmount: entered, originalCurrency: currency, rate, source: rateSource.trim() || t("expense.rateManual"), date: rateDate } : null,
        periodStart: period.on && period.from ? period.from : null, periodEnd: period.on && period.to ? period.to : null,
      };
      return { input, shares };
    } catch (e) {
      if (e instanceof SplitError) {
        if (e.code === "exact_sum_mismatch") {
          const left = total - (split as { parts: { amount: number }[] }).parts.reduce((a, p) => a + p.amount, 0);
          return { problem: t("expense.exactLeft", { amount: formatMoney(left, ledgerCurrency) }) };
        }
        if (e.code === "percent_sum_mismatch") {
          const sum = (split as { parts: { bps: number }[] }).parts.reduce((a, p) => a + p.bps, 0);
          return { problem: t("expense.percentLeft", { percent: String((10000 - sum) / 100).replace(".", ",") }) };
        }
        return { problem: tDyn(`errors.${e.code}`, t("errors.generic")) };
      }
      return { problem: t("errors.generic") };
    }
  }, [amount, title, note, category, date, currency, rate, rateSource, rateDate, fxOn, ledgerCurrency, multiPayer, payer, payerAmounts, type, included, exact, percent, weights, items, extras, period, members]);

  const toggle = (id: string) => setIncluded(included.includes(id) ? included.filter((x) => x !== id) : [...included, id]);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const types: SplitType[] = ["equal", "exact", "percent", "shares", "itemized"];
  const cats = [...new Set([...(CATEGORIES_BY_TYPE[groupType] ?? []), category, "other" as Category])];

  const applyProration = () => {
    if (!period.from || !period.to) return setError(t("expense.needPeriod"));
    run(() => prorationAction(groupId, period.from, period.to), (ws) => {
      if (!ws.length) return setError(t("expense.noStay"));
      setType("shares"); setIncluded(ws.map((w) => w.memberId)); setWeights(Object.fromEntries(ws.map((w) => [w.memberId, String(w.weight)]))); setProrated(true);
    });
  };

  return (
    <form className="grid gap-5" onSubmit={(e) => {
      e.preventDefault();
      if (!built.input) return setError(built.problem ?? t("errors.generic"));
      run(() => saveExpenseAction(groupId, initial?.id ?? null, built.input, initial?.version), (d) => { router.push(`/groups/${groupId}/expenses/${d.id}`); router.refresh(); });
    }}>
      {initial?.isDraft && <Notice tone="warn">{t("expense.draftNote")}</Notice>}
      <Field label={t("expense.title")}><input className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("expense.titlePh")} /></Field>

      {type !== "itemized" && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={t("expense.amount")}><input className="input text-xl font-bold" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus={!initial} /></Field>
          <Field label={t("expense.currency")}><select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
      )}
      {foreign && type !== "itemized" && (
        <div className="card grid gap-3">
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
            <span><b>{t("expense.convert", { currency: groupCurrency })}</b><span className="muted block">{t("expense.convertBody", { currency })}</span></span></label>
          {convert && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("expense.rate", { from: currency, to: groupCurrency })}><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0,0000" /></Field>
                <Field label={t("expense.rateDate")}><input className="input" type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} /></Field>
              </div>
              <Field label={t("expense.rateSource")}><input className="input" maxLength={40} value={rateSource} onChange={(e) => setRateSource(e.target.value)} /></Field>
              {fxEnabled && <button type="button" className="btn-secondary btn-sm justify-self-start" onClick={() => run(() => suggestRateAction(currency, groupCurrency), (r) => { if (!r) return setError(t("expense.rateUnavailable")); setRate(r.rate.replace(".", ",")); setRateSource(r.source); setRateDate(r.date); })}>{t("expense.rateSuggest")}</button>}
              {built.input?.fx && <p className="text-sm">{t("expense.converted", { original: formatMoney(built.input.fx.originalAmount, currency), amount: formatMoney(built.input.amount, groupCurrency) })}</p>}
              <p className="muted text-xs">{t("expense.rateNote")}</p>
            </>
          )}
        </div>
      )}

      <fieldset>
        <legend className="label">{t("expense.category")}</legend>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => <button type="button" key={c} aria-pressed={category === c} onClick={() => setCategory(c)} className={`chip ${category === c ? "chip-on" : ""}`}><span aria-hidden>{CATEGORY_EMOJI[c]}</span>{t(`category.${c}`)}</button>)}
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="label">{t("expense.paidBy")}</legend>
        {!multiPayer ? (
          <select className="input" aria-label={t("expense.paidBy")} value={payer} onChange={(e) => setPayer(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === meId ? ` (${t("common.you")})` : ""}</option>)}</select>
        ) : (
          <ul className="grid gap-2">{members.map((m) => (
            <li key={m.id} className="grid grid-cols-[1fr_8rem] items-center gap-2"><span className="text-sm">{m.name}</span>
              <input className="input" inputMode="decimal" aria-label={t("expense.paidAmountOf", { name: m.name })} placeholder="0,00" value={payerAmounts[m.id] ?? ""} onChange={(e) => setPayerAmounts({ ...payerAmounts, [m.id]: e.target.value })} /></li>
          ))}</ul>
        )}
        <button type="button" className="btn-ghost btn-sm justify-self-start" onClick={() => setMultiPayer(!multiPayer)}>{multiPayer ? t("expense.singlePayer") : t("expense.multiPayer")}</button>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="label">{t("expense.split")}</legend>
        <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-paper-line">
          {types.map((x) => <button key={x} type="button" role="tab" aria-selected={type === x} onClick={() => { setType(x); setProrated(false); }} className={`min-h-[40px] flex-1 whitespace-nowrap rounded-lg px-2.5 text-sm font-semibold ${type === x ? "bg-brand-600 text-white" : "text-ink-soft"}`}>{t(`split.${x}`)}</button>)}
        </div>
        <p className="muted text-xs">{t(`splitHint.${type}`)}</p>

        {type !== "itemized" ? (
          <ul className="grid gap-1.5">
            {members.map((m) => {
              const on = included.includes(m.id);
              const share = built.shares?.find((s) => s.memberId === m.id);
              return (
                <li key={m.id} className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 ${on ? "border-paper-line bg-white" : "border-transparent bg-paper opacity-70"}`}>
                  <label className="flex flex-1 items-center gap-3 text-sm"><input type="checkbox" checked={on} onChange={() => toggle(m.id)} /><span className="font-medium">{m.name}</span></label>
                  {on && type === "exact" && <input className="input !min-h-[40px] w-28 text-right" inputMode="decimal" aria-label={t("expense.shareOf", { name: m.name })} placeholder="0,00" value={exact[m.id] ?? ""} onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })} />}
                  {on && type === "percent" && <span className="flex items-center gap-1"><input className="input !min-h-[40px] w-20 text-right" inputMode="decimal" aria-label={t("expense.percentOf", { name: m.name })} placeholder="0" value={percent[m.id] ?? ""} onChange={(e) => setPercent({ ...percent, [m.id]: e.target.value })} /><span className="text-sm">%</span></span>}
                  {on && type === "shares" && <span className="flex items-center gap-1"><input className="input !min-h-[40px] w-16 text-right" inputMode="numeric" aria-label={t("expense.weightOf", { name: m.name })} value={weights[m.id] ?? "1"} onChange={(e) => setWeights({ ...weights, [m.id]: e.target.value })} /><span className="muted text-xs">{prorated ? t("expense.days") : t("expense.weight")}</span></span>}
                  {on && share && type !== "exact" && <span className="w-24 text-right text-sm font-semibold">{formatMoney(share.amount, ledgerCurrency)}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid gap-3">
            {items.map((it, idx) => (
              <div key={idx} className="card grid gap-2 p-3">
                <div className="grid grid-cols-[1fr_7rem_auto] gap-2">
                  <input className="input" aria-label={t("expense.itemName")} placeholder={t("expense.itemName")} maxLength={120} value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
                  <input className="input text-right" aria-label={t("expense.itemAmount")} inputMode="decimal" placeholder="0,00" value={it.amount} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, amount: e.target.value } : x)))} />
                  <button type="button" className="grid h-12 w-10 place-items-center text-ink-mute" aria-label={t("expense.itemRemove")} onClick={() => setItems(items.filter((_, j) => j !== idx))} disabled={items.length === 1}><Trash2 aria-hidden className="h-4 w-4" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const on = it.members.includes(m.id);
                    return <button type="button" key={m.id} aria-pressed={on} className={`chip !min-h-[36px] !px-3 text-xs ${on ? "chip-on" : ""}`} onClick={() => setItems(items.map((x, j) => (j === idx ? { ...x, members: on ? x.members.filter((y) => y !== m.id) : [...x.members, m.id] } : x)))}>{m.name}</button>;
                  })}
                </div>
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm justify-self-start" onClick={() => setItems([...items, { name: "", amount: "", members: all }])}><Plus aria-hidden className="h-4 w-4" />{t("expense.itemAdd")}</button>
            <div className="grid grid-cols-3 gap-2">
              {(["discount", "service", "tip"] as const).map((k) => <Field key={k} label={t(`expense.${k}`)}><input className="input" inputMode="decimal" placeholder="0,00" value={extras[k]} onChange={(e) => setExtras({ ...extras, [k]: e.target.value })} /></Field>)}
            </div>
            <Field label={t("expense.extrasMode")}><select className="input" value={extras.mode} onChange={(e) => setExtras({ ...extras, mode: e.target.value as "proportional" | "equal" })}><option value="proportional">{t("expense.extrasProportional")}</option><option value="equal">{t("expense.extrasEqual")}</option></select></Field>
            <Field label={t("expense.currency")}><select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
        )}
      </fieldset>

      {built.shares ? (
        <section aria-live="polite" className="rounded-2xl border border-brand-600/25 bg-brand-50 p-4">
          <div className="row"><p className="text-sm font-bold text-brand-800">{t("expense.preview")}</p><p className="text-lg font-extrabold text-brand-800">{formatMoney(built.input!.amount, ledgerCurrency)}</p></div>
          <ul className="mt-2 grid gap-1 text-sm">
            {built.shares.map((s) => <li key={s.memberId} className="row"><span>{name(s.memberId)}</span><span className="font-semibold">{formatMoney(s.amount, ledgerCurrency)}{s.rounding !== 0 && <sup title={t("expense.roundingTitle")}> *</sup>}</span></li>)}
          </ul>
          {built.shares.some((s) => s.rounding !== 0) && <p className="mt-2 text-xs text-brand-800">* {t("expense.roundingNote")}</p>}
        </section>
      ) : <p className="muted text-sm" aria-live="polite">{built.problem}</p>}

      <details className="card" open={!!note || period.on}>
        <summary className="cursor-pointer text-sm font-semibold">{t("expense.more")}</summary>
        <div className="mt-4 grid gap-4">
          <Field label={t("expense.date")}><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t("expense.note")}><textarea className="input min-h-[80px] py-2.5" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {groupType === "home" && (
            <div className="grid gap-3">
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={period.on} onChange={(e) => setPeriod({ ...period, on: e.target.checked })} /><span><b>{t("expense.period")}</b><span className="muted block">{t("expense.periodBody")}</span></span></label>
              {period.on && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t("expense.periodFrom")}><input className="input" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></Field>
                    <Field label={t("expense.periodTo")}><input className="input" type="date" min={period.from} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></Field>
                  </div>
                  <button type="button" className="btn-secondary btn-sm justify-self-start" disabled={pending} onClick={applyProration}>{t("expense.prorate")}</button>
                </>
              )}
            </div>
          )}
        </div>
      </details>

      <ErrorText>{error}</ErrorText>
      <button className="btn-primary sticky bottom-24 shadow-lg" disabled={pending}>{pending ? t("common.wait") : initial ? t("common.save") : t("expense.submit")}</button>
    </form>
  );
}
