"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, UserPlus } from "lucide-react";
import {
  addPlaceholderAction, createInviteAction, includeMemberAction, proposeCoupleAction, remindAction, removeMemberAction, reportPaymentAction,
  requestLinkAction, revokeInviteAction, setArchivedAction, settleLinkAction, updateGroupSettingsAction, updateMemberAction,
} from "@/app/actions";
import { ActButton, ErrorText, Field, ShareRow, Sheet, useAct } from "@/components/client";
import { Notice } from "@/components/ui";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { firstName } from "@/lib/format";
import { t } from "@/lib/i18n";

type Transfer = { from: string; to: string; amount: number; currency: string };

/** Hesaplaşma planındaki bir satır için eylemler. Borçlu: Ödeş. Alacaklı: iste / aldım / hatırlat. */
export function TransferActions({ groupId, groupName, transfer: x, fromName, toName, role, debtorHasAccount }: {
  groupId: string; groupName: string; transfer: Transfer; fromName: string; toName: string; role: "debtor" | "creditor" | "admin"; debtorHasAccount: boolean;
}) {
  const router = useRouter();
  const { pending, error, run, setError } = useAct();
  const [share, setShare] = useState<{ url: string; amount: number } | null>(null);
  const [recv, setRecv] = useState(false);
  const [amount, setAmount] = useState(minorToInput(x.amount));
  const [info, setInfo] = useState<string | null>(null);
  const body = { fromMember: x.from, toMember: x.to, amount: x.amount, currency: x.currency };

  if (role === "debtor") {
    return (
      <div className="grid gap-1">
        <button className="btn-primary" disabled={pending} onClick={() => run(() => settleLinkAction(groupId, body), (d) => router.push(new URL(d.url).pathname))}>
          {pending ? t("common.wait") : t("settle.pay", { amount: formatMoney(x.amount, x.currency) })}
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }
  const text = share ? t("share.payText", { group: groupName, to: firstName(toName), amount: formatMoney(share.amount, x.currency), url: share.url }) : "";
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(() => settleLinkAction(groupId, body), (d) => { setShare({ url: d.url, amount: d.amount }); router.refresh(); })}>{t("settle.request")}</button>
        <button className="btn-secondary btn-sm" onClick={() => { setRecv(true); setError(null); }}>{t("settle.received")}</button>
        <button className="btn-ghost btn-sm" disabled={pending} onClick={() => { setInfo(null); run(() => remindAction(groupId, x.from, x.currency), () => setInfo(t("settle.reminded", { name: firstName(fromName) }))); }}>{t("settle.remind")}</button>
      </div>
      {!debtorHasAccount && <p className="muted text-xs">{t("settle.noAccountHint", { name: firstName(fromName) })}</p>}
      <ErrorText>{!recv && !share ? error : null}</ErrorText>
      {info && <p role="status" className="text-sm font-medium text-brand-700">{info}</p>}

      <Sheet open={!!share} onClose={() => setShare(null)} title={t("settle.shareTitle")}>
        <div className="grid gap-3">
          <p className="whitespace-pre-line rounded-xl bg-white px-3 py-3 text-sm ring-1 ring-paper-line">{text}</p>
          <ShareRow text={text} />
          <p className="muted text-xs">{t("settle.shareNote")}</p>
        </div>
      </Sheet>
      <Sheet open={recv} onClose={() => setRecv(false)} title={t("settle.receivedTitle", { name: firstName(fromName) })}>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          const minor = parseMoney(amount);
          if (!minor) return setError(t("errors.amount_required"));
          run(() => reportPaymentAction(groupId, { ...body, amount: minor }), () => { setRecv(false); router.refresh(); });
        }}>
          <Field label={t("settle.amount", { currency: x.currency })} hint={t("settle.partialHint")}><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Notice>{role === "admin" ? t("settle.adminRecordNote") : t("settle.receivedNote")}</Notice>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" disabled={pending}>{t("settle.receivedSubmit")}</button>
        </form>
      </Sheet>
    </div>
  );
}

export function RequestShare({ groupId, requestId, groupName, toName, amount, mine }: { groupId: string; requestId: string; groupName: string; toName: string; amount: string; mine: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useAct();
  const [url, setUrl] = useState<string | null>(null);
  const text = url ? t("share.payText", { group: groupName, to: firstName(toName), amount, url }) : "";
  return (
    <>
      <span className="inline-flex flex-col gap-1">
        <button className={mine ? "btn-primary btn-sm" : "btn-secondary btn-sm"} disabled={pending}
          onClick={() => run(() => requestLinkAction(groupId, requestId), (u) => (mine ? router.push(new URL(u).pathname) : setUrl(u)))}>{mine ? t("payments.payNow") : t("payments.shareLink")}</button>
        <ErrorText>{error}</ErrorText>
      </span>
      <Sheet open={!!url} onClose={() => setUrl(null)} title={t("settle.shareTitle")}>
        <div className="grid gap-3"><p className="whitespace-pre-line rounded-xl bg-white px-3 py-3 text-sm ring-1 ring-paper-line">{text}</p><ShareRow text={text} /></div>
      </Sheet>
    </>
  );
}

export function InvitePanel({ groupId, groupName, inviterName, target, compact, activeLinks = [], canRevoke }: {
  groupId: string; groupName: string; inviterName: string; target?: { id: string; name: string }; compact?: boolean; activeLinks?: { id: string; label: string; meta: string }[]; canRevoke?: boolean;
}) {
  const { pending, error, run } = useAct();
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const create = () => run(() => createInviteAction(groupId, target?.id), (d) => { setLink(d.url); router.refresh(); });
  const text = link ? t(target ? "share.invitePersonalText" : "share.inviteText", { inviter: firstName(inviterName), group: groupName, url: link, name: target ? firstName(target.name) : "" }) : "";
  return (
    <>
      {compact ? (
        <button className="btn-secondary btn-sm" disabled={pending} onClick={create} aria-label={t("members.invitePerson", { name: target?.name ?? "" })}><UserPlus aria-hidden className="h-4 w-4" />{t("members.inviteShort")}</button>
      ) : (
        <div className="grid gap-2">
          <button className="btn-primary" disabled={pending} onClick={create}>{pending ? t("common.wait") : t("members.createLink")}</button>
          <ErrorText>{error}</ErrorText>
          {activeLinks.length > 0 && (
            <ul className="grid gap-1.5">
              {activeLinks.map((l) => (
                <li key={l.id} className="row rounded-xl bg-paper px-3 py-2 text-sm">
                  <span><span className="font-medium">{l.label}</span><span className="muted block text-xs">{l.meta}</span></span>
                  {canRevoke && <ActButton action={revokeInviteAction.bind(null, groupId, l.id)} label={t("members.revoke")} className="btn-ghost btn-sm" confirm={t("members.revokeConfirm")} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Sheet open={!!link} onClose={() => setLink(null)} title={target ? t("members.personalTitle", { name: target.name }) : t("members.inviteTitle")}>
        <div className="grid gap-3">
          <p className="whitespace-pre-line rounded-xl bg-white px-3 py-3 text-sm ring-1 ring-paper-line">{text}</p>
          <ShareRow text={text} groupId={groupId} />
          <p className="muted text-xs">{target ? t("members.personalNote", { name: target.name }) : t("newGroup.linkNote")}</p>
        </div>
      </Sheet>
    </>
  );
}

export function AddPlaceholder({ groupId }: { groupId: string }) {
  const [name, setName] = useState("");
  const { pending, error, run } = useAct();
  const router = useRouter();
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addPlaceholderAction(groupId, name), () => { setName(""); router.refresh(); }); }}>
      <span className="label !mb-0">{t("members.addPlaceholder")}</span>
      <div className="flex gap-2">
        <input className="input" aria-label={t("newGroup.personPh")} placeholder={t("newGroup.personPh")} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-secondary" disabled={pending}>{t("common.add")}</button>
      </div>
      <p className="muted text-xs">{t("members.placeholderHint")}</p>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

export function MemberEdit({ groupId, member, isSelf, canAdmin, showStay }: {
  groupId: string; isSelf: boolean; canAdmin: boolean; showStay: boolean;
  member: { id: string; name: string; role: string; hasAccount: boolean; stayFrom: string | null; stayTo: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: member.name, stayFrom: member.stayFrom ?? "", stayTo: member.stayTo ?? "", role: member.role });
  const { pending, error, run } = useAct();
  const router = useRouter();
  return (
    <>
      <button className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-brand-50" aria-label={t("members.edit", { name: member.name })} onClick={() => setOpen(true)}><Pencil aria-hidden className="h-4 w-4" /></button>
      <Sheet open={open} onClose={() => setOpen(false)} title={member.name}>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          run(() => updateMemberAction(groupId, member.id, { name: f.name, stayFrom: f.stayFrom, stayTo: f.stayTo, role: f.role === "guest" ? undefined : f.role }), () => { setOpen(false); router.refresh(); });
        }}>
          <Field label={t("members.nameInGroup")}><input className="input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          {showStay && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("members.stayFrom")}><input className="input" type="date" value={f.stayFrom} onChange={(e) => setF({ ...f, stayFrom: e.target.value })} /></Field>
              <Field label={t("members.stayTo")}><input className="input" type="date" value={f.stayTo} onChange={(e) => setF({ ...f, stayTo: e.target.value })} /></Field>
              <p className="muted col-span-2 text-xs">{t("members.stayHint")}</p>
            </div>
          )}
          {canAdmin && member.hasAccount && member.role !== "guest" && (
            <Field label={t("members.role")}>
              <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">{t("members.member")}</option><option value="admin">{t("members.admin")}</option></select>
            </Field>
          )}
          {member.role === "guest" && <Notice>{t("members.guestExplain")}</Notice>}
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" disabled={pending}>{t("common.save")}</button>
          <ActButton className="btn-danger" label={isSelf ? t("members.leave") : t("members.remove")} confirm={isSelf ? t("members.leaveConfirm") : t("members.removeConfirm", { name: member.name })}
            action={removeMemberAction.bind(null, groupId, member.id)} href={isSelf ? "/groups" : undefined} />
          <p className="muted text-xs">{t("members.removeNote")}</p>
        </form>
      </Sheet>
    </>
  );
}

export function IncludeMember({ groupId, memberId, memberName, expenses }: { groupId: string; memberId: string; memberName: string; expenses: { id: string; title: string; date: string; amount: string }[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const { pending, error, run } = useAct();
  const router = useRouter();
  if (!expenses.length) return null;
  return (
    <>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}>{t("members.include")}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("members.includeTitle", { name: memberName })}>
        <div className="grid gap-3">
          <p className="muted">{t("members.includeBody")}</p>
          <ul className="grid gap-1">
            {expenses.map((e) => (
              <li key={e.id}><label className="flex min-h-[48px] items-center gap-3 rounded-xl bg-white px-3 text-sm ring-1 ring-paper-line">
                <input type="checkbox" checked={sel.includes(e.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} />
                <span className="flex-1">{e.title}<span className="muted block text-xs">{e.date}</span></span><b>{e.amount}</b>
              </label></li>
            ))}
          </ul>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" disabled={pending || !sel.length} onClick={() => run(() => includeMemberAction(groupId, memberId, sel), () => { setOpen(false); setSel([]); router.refresh(); })}>{t("members.includeSubmit", { n: sel.length })}</button>
        </div>
      </Sheet>
    </>
  );
}

export function CouplePropose({ groupId, options }: { groupId: string; options: { id: string; name: string }[] }) {
  const [id, setId] = useState(options[0]?.id ?? "");
  const { pending, error, run } = useAct();
  if (!options.length) return <p className="muted text-xs">{t("couple.none")}</p>;
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <select className="input" aria-label={t("couple.pick")} value={id} onChange={(e) => setId(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <button className="btn-secondary" disabled={pending} onClick={() => run(() => proposeCoupleAction(groupId, id))}>{t("couple.propose")}</button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function SettingsForm({ group, isAdmin, myMemberId }: {
  group: { id: string; name: string; simplify: boolean; schedule: string; settleDate: string | null; startDate: string | null; endDate: string | null; type: string; archived: boolean };
  isAdmin: boolean; myMemberId: string;
}) {
  const [f, setF] = useState({ name: group.name, simplifyDebts: group.simplify, settleSchedule: group.schedule, settleDate: group.settleDate ?? "", startDate: group.startDate ?? "", endDate: group.endDate ?? "" });
  const { pending, error, run } = useAct();
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const schedules = ["manual", "weekly", "month_end", "date", ...(group.type === "trip" ? ["trip_end"] : [])];
  return (
    <div className="grid gap-4">
      {!isAdmin && <Notice>{t("settings.adminOnly")}</Notice>}
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setSaved(false); run(() => updateGroupSettingsAction(group.id, f), () => { setSaved(true); router.refresh(); }); }}>
        <fieldset disabled={!isAdmin} className="grid gap-4">
          <Field label={t("newGroup.name")}><input className="input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <label className="card flex items-start gap-3">
            <input type="checkbox" className="mt-0.5" checked={f.simplifyDebts} onChange={(e) => setF({ ...f, simplifyDebts: e.target.checked })} />
            <span><span className="font-semibold">{t("settings.simplify")}</span><span className="muted block">{t("settings.simplifyBody")}</span></span>
          </label>
          <Field label={t("newGroup.schedule")} hint={t("newGroup.scheduleHint")}>
            <select className="input" value={f.settleSchedule} onChange={(e) => setF({ ...f, settleSchedule: e.target.value })}>{schedules.map((s) => <option key={s} value={s}>{t(`schedule.${s}` as "schedule.manual")}</option>)}</select>
          </Field>
          {f.settleSchedule === "date" && <Field label={t("newGroup.settleDate")}><input className="input" type="date" required value={f.settleDate} onChange={(e) => setF({ ...f, settleDate: e.target.value })} /></Field>}
          {group.type === "trip" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("newGroup.start")}><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              <Field label={t("newGroup.end")}><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          {saved && <p role="status" className="text-sm font-medium text-brand-700">{t("common.saved")}</p>}
          {isAdmin && <button className="btn-primary" disabled={pending}>{t("common.save")}</button>}
        </fieldset>
      </form>
      <div className="grid gap-2 border-t border-paper-line pt-4">
        {isAdmin && <ActButton className="btn-secondary" label={group.archived ? t("settings.unarchive") : t("settings.archive")} action={setArchivedAction.bind(null, group.id, !group.archived)} confirm={group.archived ? undefined : t("settings.archiveConfirm")} />}
        <ActButton className="btn-danger" label={t("members.leave")} confirm={t("members.leaveConfirm")} action={removeMemberAction.bind(null, group.id, myMemberId)} href="/groups" />
        <p className="muted text-xs">{t("settings.noDelete")}</p>
      </div>
    </div>
  );
}
