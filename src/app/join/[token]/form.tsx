"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelClaimAction, joinAction } from "@/app/actions";
import { ErrorText, Field, useAct } from "@/components/client";
import { Notice } from "@/components/ui";
import { t } from "@/lib/i18n";

export function JoinForm(p: { token: string; groupId: string; loggedInName: string | null; already: boolean; pendingClaim: boolean; targeted: boolean; placeholders: { id: string; display_name: string }[] }) {
  const router = useRouter();
  const { pending, error, run } = useAct();
  const [name, setName] = useState(p.targeted ? p.placeholders[0]?.display_name ?? "" : "");
  const [terms, setTerms] = useState(false);
  const [claim, setClaim] = useState<string>("");
  const [waiting, setWaiting] = useState(p.pendingClaim);

  if (p.already) return <Link href={`/groups/${p.groupId}`} className="btn-primary mt-4 w-full">{t("join.open")}</Link>;
  if (waiting) {
    return (
      <div className="mt-4 grid gap-3">
        <Notice tone="warn" title={t("join.waitTitle")}>{t("join.waitBody")}</Notice>
        <button className="btn-secondary" disabled={pending} onClick={() => run(() => cancelClaimAction(p.groupId), () => { setWaiting(false); router.refresh(); })}>{t("join.cancelClaim")}</button>
        <button className="btn-ghost" onClick={() => router.refresh()}>{t("join.checkAgain")}</button>
      </div>
    );
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => joinAction(p.token, { name, terms, claimMemberId: p.targeted ? null : claim || null }), (r) => {
      if (r.status === "claim_pending") { setWaiting(true); router.refresh(); }
      else { router.push(`/groups/${r.groupId}`); router.refresh(); }
    });
  };
  return (
    <form onSubmit={submit} className="mt-5 grid gap-4">
      {p.loggedInName ? (
        <p className="text-sm">{t("join.asUser", { name: p.loggedInName })}</p>
      ) : (
        <>
          <Field label={t("auth.name")}><input className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.namePh")} autoComplete="given-name" /></Field>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>{t("auth.terms")} <Link className="underline" href="/legal/terms" target="_blank">{t("legal.terms")}</Link>, <Link className="underline" href="/legal/kvkk" target="_blank">{t("legal.kvkk")}</Link></span></label>
        </>
      )}
      {p.targeted && p.placeholders[0] && <Notice tone="ok">{t("join.personal", { name: p.placeholders[0].display_name })}</Notice>}
      {!p.targeted && p.placeholders.length > 0 && (
        <fieldset className="card">
          <legend className="px-1 text-sm font-semibold">{t("join.claimTitle")}</legend>
          <div className="mt-1 grid gap-1">
            <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="radio" name="claim" checked={claim === ""} onChange={() => setClaim("")} />{t("join.claimNone")}</label>
            {p.placeholders.map((ph) => (
              <label key={ph.id} className="flex min-h-[44px] items-center gap-3 text-sm"><input type="radio" name="claim" checked={claim === ph.id} onChange={() => setClaim(ph.id)} />{t("join.claimIs", { name: ph.display_name })}</label>
            ))}
          </div>
          {claim && <p className="muted mt-2 text-xs">{t("join.claimNote")}</p>}
        </fieldset>
      )}
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" disabled={pending}>{pending ? t("common.wait") : claim ? t("join.submitClaim") : t("join.submit")}</button>
      {!p.loggedInName && <p className="muted text-center text-xs">{t("join.noApp")} <Link className="underline" href={`/login?next=/join/${p.token}`}>{t("join.haveAccount")}</Link></p>}
    </form>
  );
}
