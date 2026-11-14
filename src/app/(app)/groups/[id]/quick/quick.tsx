"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square } from "lucide-react";
import { draftFromTextAction, saveExpenseAction } from "@/app/actions";
import { ErrorText, useAct } from "@/components/client";
import { Notice } from "@/components/ui";
import type { ExpenseInput } from "@/lib/expense-calc";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";

type Draft = { questions: string[]; input: ExpenseInput | null; shares: { memberId: string; amount: number }[] };
// Tarayıcının kendi konuşma tanıması (Web Speech API). Ses kaydı sunucumuza gönderilmez ve saklanmaz.
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

export function QuickAdd({ groupId, members, provider }: { groupId: string; members: { id: string; name: string }[]; provider: "rules" | "anthropic" }) {
  const router = useRouter();
  const { pending, error, run, setError } = useAct();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [consent, setConsent] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  const startVoice = () => {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return setError(t("quick.voiceUnsupported"));
    const r = new Ctor();
    r.lang = "tr-TR"; r.interimResults = true; r.continuous = false;
    const base = text.trim();
    r.onresult = (e) => setText([base, Array.from(e.results).map((x) => x[0].transcript).join(" ")].filter(Boolean).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setError(t("quick.voiceError")); };
    rec.current = r; setListening(true); setError(null); r.start();
  };
  const analyze = () => { setDraft(null); run(() => draftFromTextAction(groupId, text), (d) => setDraft(d)); };

  return (
    <div className="grid gap-4">
      <p className="muted">{t("quick.lead")}</p>
      <textarea className="input min-h-[120px] py-3" aria-label={t("quick.title")} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("quick.placeholder")} />
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={pending || text.trim().length < 3} onClick={analyze}>{pending ? t("common.wait") : t("quick.analyze")}</button>
        {listening ? (
          <button className="btn-danger" onClick={() => rec.current?.stop()}><Square aria-hidden className="h-4 w-4" />{t("quick.stop")}</button>
        ) : (
          <button className="btn-secondary" onClick={() => (consent ? startVoice() : setAskConsent(true))}><Mic aria-hidden className="h-5 w-5" />{t("quick.speak")}</button>
        )}
      </div>
      {listening && <p role="status" className="text-sm font-semibold text-brand-700">{t("quick.listening")}</p>}
      {askConsent && !consent && (
        <div className="card grid gap-3 text-sm">
          <p className="font-semibold">{t("quick.consentTitle")}</p>
          <p className="muted">{t("quick.consentBody")}</p>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => { setConsent(true); setAskConsent(false); startVoice(); }}>{t("quick.consentOk")}</button>
            <button className="btn-secondary btn-sm" onClick={() => setAskConsent(false)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {draft && draft.questions.length > 0 && (
        <Notice tone="warn" title={t("quick.needInfo")}>
          <ul className="mt-1 list-disc pl-5">{draft.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          <p className="mt-2 text-xs">{t("quick.needInfoHint")}</p>
        </Notice>
      )}
      {draft?.input && (
        <section className="card grid gap-3" aria-live="polite">
          <div className="row"><h2>{draft.input.title}</h2><p className="text-xl font-extrabold">{formatMoney(draft.input.amount, draft.input.currency)}</p></div>
          <p className="text-sm">{t("quick.paidBy", { name: name(draft.input.payers[0].memberId) })}</p>
          {draft.input.split.type === "itemized" && (
            <ul className="grid gap-1 rounded-xl bg-paper px-3 py-2 text-sm">
              {draft.input.split.items.map((it, i) => <li key={i}><div className="row"><span>{it.name}</span><b>{formatMoney(it.amount, draft.input!.currency)}</b></div><p className="muted text-xs">{it.claims.map((c) => name(c.memberId)).join(", ")}</p></li>)}
            </ul>
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-mute">{t("quick.perPerson")}</p>
            <ul className="mt-1 grid gap-1 text-sm">{draft.shares.map((s) => <li key={s.memberId} className="row"><span>{name(s.memberId)}</span><b>{formatMoney(s.amount, draft.input!.currency)}</b></li>)}</ul>
          </div>
          <Notice>{t("quick.confirmNote")}</Notice>
          <button className="btn-primary" disabled={pending} onClick={() => run(() => saveExpenseAction(groupId, null, draft.input), (d) => { router.push(`/groups/${groupId}/expenses/${d.id}`); router.refresh(); })}>{t("quick.confirm")}</button>
          <button className="btn-ghost" onClick={() => setDraft(null)}>{t("quick.discard")}</button>
        </section>
      )}
      <p className="muted text-xs">{provider === "rules" ? t("quick.providerRules") : t("quick.providerAi")}</p>
    </div>
  );
}
