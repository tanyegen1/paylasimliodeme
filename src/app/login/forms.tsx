"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { demoLoginAction, loginAction, registerAction, startGuestAction } from "@/app/actions";
import { ErrorText, Field, useAct } from "@/components/client";
import { Notice } from "@/components/ui";
import { t } from "@/lib/i18n";

type Mode = "start" | "login" | "register";

export function AuthForms({ next, initial, demoUsers }: { next: string; initial: Mode; demoUsers: { id: string; display_name: string }[] }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [f, setF] = useState({ name: "", email: "", password: "", terms: false, marketing: false });
  const { pending, error, run, setError } = useAct();
  const router = useRouter();
  const done = () => { router.push(next); router.refresh(); };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") run(() => loginAction({ email: f.email, password: f.password }), done);
    else if (mode === "register") run(() => registerAction(f), done);
    else run(() => startGuestAction({ name: f.name, terms: f.terms }), done);
  };
  const tabs: Mode[] = ["start", "login", "register"];
  return (
    <div className="mt-8">
      <h1>{t(`auth.title_${mode}`)}</h1>
      <p className="muted mt-1">{t(`auth.lead_${mode}`)}</p>
      <div role="tablist" className="mt-5 grid grid-cols-3 gap-1 rounded-xl bg-white p-1 ring-1 ring-paper-line">
        {tabs.map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => { setMode(m); setError(null); }}
            className={`min-h-[40px] rounded-lg text-sm font-semibold ${mode === m ? "bg-brand-600 text-white" : "text-ink-soft"}`}>{t(`auth.tab_${m}`)}</button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-4">
        {mode !== "login" && <Field label={t("auth.name")}><input className="input" required maxLength={60} autoComplete="given-name" value={f.name} onChange={set("name")} placeholder={t("auth.namePh")} /></Field>}
        {mode !== "start" && (
          <>
            <Field label={t("auth.email")}><input className="input" type="email" required autoComplete="email" inputMode="email" value={f.email} onChange={set("email")} /></Field>
            <Field label={t("auth.password")} hint={mode === "register" ? t("auth.passwordHint") : undefined}>
              <input className="input" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "register" ? "new-password" : "current-password"} value={f.password} onChange={set("password")} />
            </Field>
          </>
        )}
        {mode !== "login" && (
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={f.terms} onChange={set("terms")} /><span>{t("auth.terms")}</span></label>
        )}
        {mode === "register" && (
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={f.marketing} onChange={set("marketing")} /><span>{t("auth.marketing")}</span></label>
        )}
        {mode === "start" && <Notice>{t("auth.guestNote")}</Notice>}
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" disabled={pending}>{pending ? t("common.wait") : t(`auth.submit_${mode}`)}</button>
      </form>
      {demoUsers.length > 0 && (
        <section className="mt-8 rounded-2xl border border-warm-600/30 bg-warm-50 p-4">
          <p className="text-sm font-bold text-warm-700">{t("demo.loginTitle")}</p>
          <p className="mt-1 text-xs text-warm-700">{t("demo.loginBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {demoUsers.map((u) => (
              <button key={u.id} type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => run(() => demoLoginAction(u.id), done)}>{u.display_name}</button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
