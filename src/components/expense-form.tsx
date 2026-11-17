"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { prorationAction, saveExpenseAction, suggestRateAction } from "@/app/actions";
import { ErrorText, Field, useAct } from "@/components/client";
import { Avatar, Notice } from "@/components/ui";
import { CATEGORIES_BY_TYPE, CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { CURRENCY_CODES, convertMinor, formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { computeShares, type ExpenseInput, type SplitInput } from "@/lib/expense-calc";
import { SplitError } from "@/lib/split";
import { guessCategory } from "@/lib/nlp-rules";
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
  const [category, setCategory] = useState<Category>(i?.category ?? "other");
  const [catTouched, setCatTouched] = useState(!!i);
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

  const advanced = type !== "equal";
  const allOn = included.length === members.length;
  const perHead = built.shares && type === "equal" && built.shares.length ? built.shares[built.shares.length - 1].amount : null;

  return (
    <form className="grid gap-6 pb-10" onSubmit={(e) => {
      e.preventDefault();
      if (!built.input) return setError(built.problem ?? t("errors.generic"));
      run(() => saveExpenseAction(groupId, initial?.id ?? null, built.input, initial?.version), (d) => { router.push(`/groups/${groupId}/expenses/${d.id}`); router.refresh(); });
    }}>
      {initial?.isDraft && <Notice tone="warn">{t("expense.draftNote")}</Notice>}

      {type !== "itemized" && (
        <section className="card text-center">
          <label htmlFor="amount" className="text-sm font-bold text-ink-mute">{t("expense.howMuch")}</label>
          <div className="mt-1 flex items-center justify-center gap-2">
            <input id="amount" aria-label={t("expense.amount")} className="w-full min-w-0 bg-transparent text-center text-[2.6rem] font-extrabold tracking-tight text-ink outline-none placeholder:text-ink-faint/60"
              inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus={!initial} />
          </div>
          <div className="mt-2 flex justify-center">
            <select aria-label={t("expense.currency")} className="rounded-full bg-paper-sunk px-3 py-1.5 text-sm font-bold text-ink-soft outline-none" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </section>
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
              {built.input?.fx && <p className="text-sm font-semibold">{t("expense.converted", { original: formatMoney(built.input.fx.originalAmount, currency), amount: formatMoney(built.input.amount, groupCurrency) })}</p>}
              <p className="muted text-xs">{t("expense.rateNote")}</p>
            </>
          )}
        </div>
      )}

      <div className="grid gap-3">
        <Field label={t("expense.title")}><input className="input" required maxLength={120} value={title} onChange={(e) => { setTitle(e.target.value); if (!catTouched) setCategory(guessCategory(e.target.value) ?? "other"); }} placeholder={t("expense.titlePh")} /></Field>
        <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label={t("expense.category")}>
          <div className="flex min-w-max gap-2">
            {cats.map((c) => <button type="button" key={c} aria-pressed={category === c} onClick={() => { setCategory(c); setCatTouched(true); }} className={`chip !min-h-[38px] !px-3 ${category === c ? "chip-on" : ""}`}><span aria-hidden>{CATEGORY_EMOJI[c]}</span>{t(`category.${c}`)}</button>)}
          </div>
        </div>
      </div>

      <fieldset>
        <legend className="label">{t("expense.paidBy")}</legend>
        {!multiPayer ? (
          <div className="-mx-4 overflow-x-auto px-4"><div className="flex min-w-max gap-2 pb-1">
            {members.map((m) => {
              const on = payer === m.id;
              return (
                <button type="button" key={m.id} aria-pressed={on} onClick={() => setPayer(m.id)}
                  className={`flex w-[74px] flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-xs font-bold transition active:scale-95 ${on ? "bg-brand-600 text-white shadow-lift" : "bg-paper-card text-ink-soft ring-1 ring-paper-line"}`}>
                  <Avatar name={m.name} size="md" ring={on} />
                  <span className="w-full truncate">{m.id === meId ? t("expense.me") : m.name}</span>
                </button>
              );
            })}
          </div></div>
        ) : (
          <ul className="card grid gap-2 !p-3">{members.map((m) => (
            <li key={m.id} className="grid grid-cols-[auto_1fr_8rem] items-center gap-3"><Avatar name={m.name} size="sm" /><span className="text-sm font-semibold">{m.name}</span>
              <input className="input !min-h-[44px] text-right" inputMode="decimal" aria-label={t("expense.paidAmountOf", { name: m.name })} placeholder="0,00" value={payerAmounts[m.id] ?? ""} onChange={(e) => setPayerAmounts({ ...payerAmounts, [m.id]: e.target.value })} /></li>
          ))}</ul>
        )}
        <button type="button" className="mt-1 text-sm font-bold text-brand-700" onClick={() => setMultiPayer(!multiPayer)}>{multiPayer ? t("expense.singlePayer") : t("expense.multiPayer")}</button>
      </fieldset>

      <fieldset className="grid gap-3">
        <div className="row">
          <legend className="label !mb-0">{t("expense.splitWith")}</legend>
          {type !== "itemized" && <button type="button" className="text-sm font-bold text-brand-700" onClick={() => setIncluded(allOn ? [] : members.map((m) => m.id))}>{allOn ? t("expense.noneAll") : t("expense.everyone")}</button>}
        </div>

        {type !== "itemized" && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {members.map((m) => {
              const on = included.includes(m.id);
              const share = built.shares?.find((x) => x.memberId === m.id);
              return (
                <li key={m.id}>
                  <button type="button" aria-pressed={on} onClick={() => toggle(m.id)}
                    className={`relative flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-3 transition active:scale-95 ${on ? "bg-paper-card shadow-card ring-2 ring-brand-500" : "bg-paper-sunk opacity-60 ring-1 ring-transparent"}`}>
                    {on && <span aria-hidden className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[11px] font-black text-white">✓</span>}
                    <Avatar name={m.name} size="md" />
                    <span className="w-full truncate px-1 text-center text-xs font-bold">{m.id === meId ? t("expense.me") : m.name}</span>
                    <span className={`text-[13px] font-extrabold ${on ? "text-brand-700" : "text-ink-faint"}`}>{on ? (share ? formatMoney(share.amount, ledgerCurrency) : "—") : t("expense.out")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!advanced ? (
          <button type="button" className="btn-secondary btn-sm justify-self-start" onClick={() => setType("exact")}>{t("expense.splitDifferently")}</button>
        ) : (
          <div className="card grid gap-3 !p-4">
            <div className="row"><p className="text-sm font-bold">{t("expense.splitHow")}</p><button type="button" className="text-sm font-bold text-brand-700" onClick={() => { setType("equal"); setProrated(false); }}>{t("expense.backToEqual")}</button></div>
            <div role="tablist" className="grid grid-cols-4 gap-1 rounded-2xl bg-paper-sunk p-1">
              {types.filter((x) => x !== "equal").map((x) => <button key={x} type="button" role="tab" aria-selected={type === x} onClick={() => { setType(x); setProrated(false); }} className={`min-h-[40px] rounded-xl px-1 text-[13px] font-bold transition ${type === x ? "bg-paper-card text-ink shadow-card" : "text-ink-mute"}`}>{t(`split.${x}`)}</button>)}
            </div>
            <p className="muted text-xs">{t(`splitHint.${type}`)}</p>
            {type !== "itemized" ? (
              <ul className="grid gap-2">
                {members.filter((m) => included.includes(m.id)).map((m) => {
                  const share = built.shares?.find((x) => x.memberId === m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3">
                      <Avatar name={m.name} size="sm" /><span className="flex-1 truncate text-sm font-semibold">{m.name}</span>
                      {type === "exact" && <input className="input !min-h-[44px] w-28 text-right" inputMode="decimal" aria-label={t("expense.shareOf", { name: m.name })} placeholder="0,00" value={exact[m.id] ?? ""} onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })} />}
                      {type === "percent" && <span className="flex items-center gap-1"><input className="input !min-h-[44px] w-20 text-right" inputMode="decimal" aria-label={t("expense.percentOf", { name: m.name })} placeholder="0" value={percent[m.id] ?? ""} onChange={(e) => setPercent({ ...percent, [m.id]: e.target.value })} /><span className="text-sm font-bold">%</span></span>}
                      {type === "shares" && <span className="flex items-center gap-1"><input className="input !min-h-[44px] w-16 text-right" inputMode="numeric" aria-label={t("expense.weightOf", { name: m.name })} value={weights[m.id] ?? "1"} onChange={(e) => setWeights({ ...weights, [m.id]: e.target.value })} /><span className="muted text-xs">{prorated ? t("expense.days") : t("expense.weight")}</span></span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="grid gap-3">
                {items.map((it, idx) => (
                  <div key={idx} className="grid gap-2 rounded-2xl bg-paper p-3">
                    <div className="grid grid-cols-[1fr_7rem_auto] gap-2">
                      <input className="input !min-h-[44px]" aria-label={t("expense.itemName")} placeholder={t("expense.itemName")} maxLength={120} value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
                      <input className="input !min-h-[44px] text-right" aria-label={t("expense.itemAmount")} inputMode="decimal" placeholder="0,00" value={it.amount} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, amount: e.target.value } : x)))} />
                      <button type="button" className="grid h-11 w-9 place-items-center text-ink-mute" aria-label={t("expense.itemRemove")} onClick={() => setItems(items.filter((_, j) => j !== idx))} disabled={items.length === 1}><Trash2 aria-hidden className="h-4 w-4" /></button>
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
                {built.shares && <ul className="grid gap-1 rounded-2xl bg-brand-50 p-3 text-sm">{built.shares.map((x) => <li key={x.memberId} className="row"><span>{name(x.memberId)}</span><b>{formatMoney(x.amount, ledgerCurrency)}</b></li>)}</ul>}
              </div>
            )}
          </div>
        )}
        {built.shares?.some((x) => x.rounding !== 0) && <p className="px-1 text-xs text-ink-mute">{t("expense.roundingShort")}</p>}
      </fieldset>

      <details className="card !p-4" open={!!note || period.on}>
        <summary className="cursor-pointer text-sm font-bold text-ink-soft">{t("expense.more")}</summary>
        <div className="mt-4 grid gap-4">
          <Field label={t("expense.date")}><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t("expense.note")}><textarea className="input min-h-[80px] py-3" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
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

      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-paper via-paper/95 to-paper/0 px-4 pt-6" style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto grid max-w-xl gap-2">
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full min-h-[56px] text-base" disabled={pending}>
            {pending ? t("common.wait") : built.input ? (
              <span className="flex w-full items-center justify-between gap-3"><span>{initial ? t("common.save") : t("expense.submit")}</span><span className="rounded-full bg-white/20 px-3 py-1 text-sm">{perHead != null && built.shares!.length > 1 ? t("expense.perHead", { amount: formatMoney(perHead, ledgerCurrency) }) : formatMoney(built.input.amount, ledgerCurrency)}</span></span>
            ) : (initial ? t("common.save") : t("expense.submit"))}
          </button>
          {!built.input && built.problem && <p className="rounded-xl bg-paper-card/95 px-3 py-1.5 text-center text-xs font-semibold text-ink-mute shadow-card" aria-live="polite">{built.problem}</p>}
        </div>
      </div>
    </form>
  );
}
