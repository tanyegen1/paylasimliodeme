"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { createGroupAction } from "@/app/actions";
import { ErrorText, Field, ShareRow, useAct } from "@/components/client";
import { Notice } from "@/components/ui";
import { GROUP_EMOJI, GROUP_TYPE_LIST } from "@/lib/group-types";
import { CURRENCY_CODES } from "@/lib/money";
import { firstName } from "@/lib/format";
import { t } from "@/lib/i18n";

const SCHEDULES: Record<string, string[]> = {
  home: ["month_end", "weekly", "date", "manual"], trip: ["trip_end", "date", "manual"], meal: ["manual", "date"], event: ["manual", "date"], other: ["manual", "weekly", "month_end", "date"],
};

export function NewGroupForm({ inviterName }: { inviterName: string }) {
  const [type, setType] = useState<string>("home");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("TRY");
  const [people, setPeople] = useState<string[]>([]);
  const [person, setPerson] = useState("");
  const [dates, setDates] = useState({ start: "", end: "", settle: "" });
  const [schedule, setSchedule] = useState("month_end");
  const [created, setCreated] = useState<{ id: string; inviteUrl: string } | null>(null);
  const { pending, error, run } = useAct();

  const pickType = (v: string) => { setType(v); setSchedule(SCHEDULES[v][0]); };
  const addPerson = () => {
    const v = person.trim();
    if (v && !people.some((p) => p.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr")) && people.length < 30) setPeople([...people, v]);
    setPerson("");
  };

  if (created) {
    const text = t("share.inviteText", { inviter: firstName(inviterName), group: name, url: created.inviteUrl });
    return (
      <div className="grid gap-4">
        <div className="card text-center">
          <p aria-hidden className="text-4xl">🎉</p>
          <h2 className="mt-2">{t("newGroup.doneTitle", { name })}</h2>
          <p className="muted mt-1">{t("newGroup.doneBody")}</p>
        </div>
        <div className="card grid gap-3">
          <p className="rounded-xl bg-paper px-3 py-2 text-sm text-ink-soft">{text}</p>
          <ShareRow text={text} groupId={created.id} />
          <p className="muted text-xs">{t("newGroup.linkNote")}</p>
        </div>
        <Link href={`/groups/${created.id}/expenses/new`} className="btn-primary">{t("newGroup.addFirst")}</Link>
        <Link href={`/groups/${created.id}`} className="btn-ghost">{t("newGroup.goGroup")}</Link>
      </div>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={(e) => {
      e.preventDefault();
      const pending = person.trim() ? [...people, person.trim()] : people;
      run(() => createGroupAction({ name, type, currency, placeholders: pending, startDate: dates.start, endDate: dates.end, settleSchedule: schedule, settleDate: dates.settle }), (d) => setCreated(d));
    }}>
      <fieldset>
        <legend className="label">{t("newGroup.type")}</legend>
        <div className="grid grid-cols-5 gap-2">
          {GROUP_TYPE_LIST.map((v) => (
            <button type="button" key={v} aria-pressed={type === v} onClick={() => pickType(v)}
              className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border text-xs font-semibold ${type === v ? "border-brand-600 bg-brand-50 text-brand-800" : "border-paper-line bg-white text-ink-soft"}`}>
              <span aria-hidden className="text-xl">{GROUP_EMOJI[v]}</span>{t(`groupTypeShort.${v}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label={t("newGroup.name")}><input className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`newGroup.namePh_${type}` as "newGroup.namePh_home")} /></Field>

      <div>
        <span className="label">{t("newGroup.people")}</span>
        <div className="flex gap-2">
          <input className="input" aria-label={t("newGroup.personPh")} maxLength={60} value={person} onChange={(e) => setPerson(e.target.value)} placeholder={t("newGroup.personPh")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } }} />
          <button type="button" className="btn-secondary" onClick={addPerson}>{t("common.add")}</button>
        </div>
        {people.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {people.map((p) => (
              <li key={p} className="chip chip-on">{p}
                <button type="button" aria-label={t("newGroup.removePerson", { name: p })} onClick={() => setPeople(people.filter((x) => x !== p))}><X aria-hidden className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted mt-1.5 text-xs">{t("newGroup.peopleHint")}</p>
      </div>

      {type === "trip" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("newGroup.start")}><input className="input" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} /></Field>
          <Field label={t("newGroup.end")}><input className="input" type="date" value={dates.end} min={dates.start} onChange={(e) => setDates({ ...dates, end: e.target.value })} /></Field>
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">{t("newGroup.more")}</summary>
        <div className="mt-4 grid gap-4">
          <Field label={t("newGroup.currency")}>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c} · {t(`currency.${c}`)}</option>)}</select>
          </Field>
          <Field label={t("newGroup.schedule")} hint={t("newGroup.scheduleHint")}>
            <select className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)}>{SCHEDULES[type].map((s) => <option key={s} value={s}>{t(`schedule.${s}` as "schedule.manual")}</option>)}</select>
          </Field>
          {schedule === "date" && <Field label={t("newGroup.settleDate")}><input className="input" type="date" required value={dates.settle} onChange={(e) => setDates({ ...dates, settle: e.target.value })} /></Field>}
          {schedule === "trip_end" && !dates.end && <Notice tone="warn">{t("newGroup.tripEndNeedsDate")}</Notice>}
        </div>
      </details>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" disabled={pending}>{pending ? t("common.wait") : t("newGroup.submit")}</button>
    </form>
  );
}
