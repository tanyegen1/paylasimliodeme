"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changePasswordAction, deleteAccountAction, secureAccountAction, setPrefsAction, signOutOthersAction, updateProfileAction } from "@/app/actions";
import { ActButton, ErrorText, Field, useAct } from "@/components/client";
import { t } from "@/lib/i18n";

function Saved({ on }: { on: boolean }) {
  return on ? <p role="status" className="text-sm font-medium text-brand-700">{t("common.saved")}</p> : null;
}

export function SecureForm() {
  const [f, setF] = useState({ email: "", password: "" });
  const { pending, error, run } = useAct();
  return (
    <form className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => secureAccountAction(f)); }}>
      <Field label={t("auth.email")}><input className="input" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label={t("auth.password")} hint={t("auth.passwordHint")}><input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" disabled={pending}>{t("profile.secureSubmit")}</button>
    </form>
  );
}

export function ProfileForm({ initial }: { initial: { name: string; iban: string; ibanHolder: string; marketing: boolean } }) {
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAct();
  const router = useRouter();
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setSaved(false); run(() => updateProfileAction(f), () => { setSaved(true); router.refresh(); }); }}>
      <Field label={t("auth.name")}><input className="input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t("profile.iban")} hint={t("profile.ibanHint")}><input className="input font-mono" autoComplete="off" placeholder="TR00 0000 0000 0000 0000 0000 00" value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} /></Field>
      <Field label={t("profile.ibanHolder")}><input className="input" maxLength={80} value={f.ibanHolder} onChange={(e) => setF({ ...f, ibanHolder: e.target.value })} /></Field>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.checked })} /><span>{t("auth.marketing")}</span></label>
      <ErrorText>{error}</ErrorText><Saved on={saved} />
      <button className="btn-primary" disabled={pending}>{t("common.save")}</button>
    </form>
  );
}

type Prefs = { reminders: boolean; payment_updates: boolean; group_activity: boolean; channel_email: boolean; channel_push: boolean };
export function PrefsForm({ initial }: { initial: Prefs }) {
  const [p, setP] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAct();
  const set = (k: keyof Prefs, v: boolean) => { const n = { ...p, [k]: v }; setP(n); setSaved(false); run(() => setPrefsAction(n), () => setSaved(true)); };
  return (
    <div className="grid gap-1">
      {(["reminders", "payment_updates", "group_activity"] as const).map((k) => (
        <label key={k} className="flex min-h-[48px] items-center justify-between gap-3 text-sm"><span><b>{t(`prefs.${k}`)}</b><span className="muted block text-xs">{t(`prefs.${k}_body`)}</span></span><input type="checkbox" checked={p[k]} onChange={(e) => set(k, e.target.checked)} /></label>
      ))}
      <p className="muted mt-2 rounded-xl bg-paper px-3 py-2 text-xs">{t("prefs.channels")}</p>
      <ErrorText>{error}</ErrorText><Saved on={saved} />
    </div>
  );
}

export function PasswordForm() {
  const [f, setF] = useState({ current: "", next: "" });
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAct();
  return (
    <div className="grid gap-3">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); setSaved(false); run(() => changePasswordAction(f), () => { setSaved(true); setF({ current: "", next: "" }); }); }}>
        <Field label={t("profile.currentPassword")}><input className="input" type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label={t("profile.newPassword")} hint={t("auth.passwordHint")}><input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <ErrorText>{error}</ErrorText><Saved on={saved} />
        <button className="btn-secondary" disabled={pending}>{t("profile.changePassword")}</button>
      </form>
      <ActButton action={signOutOthersAction} label={t("profile.signOutOthers")} className="btn-ghost btn-sm" doneLabel={t("common.done")} />
    </div>
  );
}

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { pending, error, run } = useAct();
  return (
    <div className="mt-4 border-t border-paper-line pt-4">
      {!open ? <button className="btn-danger btn-sm" onClick={() => setOpen(true)}>{t("profile.delete")}</button> : (
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => deleteAccountAction(confirm)); }}>
          <p className="text-sm">{t("profile.deleteBody")}</p>
          <Field label={t("profile.deleteConfirm")}><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2"><button className="btn-danger" disabled={pending}>{t("profile.deleteSubmit")}</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button></div>
        </form>
      )}
    </div>
  );
}
