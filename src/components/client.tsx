"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Share2, X } from "lucide-react";
import type { Result } from "@/app/actions";
import { inviteSharedAction } from "@/app/actions";
import { t } from "@/lib/i18n";

/** Sunucu eylemini çalıştırır; hata mesajını ve bekleme durumunu yönetir. */
export function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    <T,>(fn: () => Promise<Result<T>>, onOk?: (data: T) => void) => {
      setError(null);
      start(async () => {
        try {
          const r = await fn();
          if (!r.ok) return setError(r.error);
          if (onOk) onOk(r.data);
          else router.refresh();
        } catch {
          setError(t("errors.network"));
        }
      });
    },
    [router],
  );
  return { pending, error, setError, run };
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-600">{children}</p>;
}

export function ActButton({ action, label, className = "btn-secondary btn-sm", confirm, href, doneLabel }: {
  action: () => Promise<Result<unknown>>; label: React.ReactNode; className?: string; confirm?: string; href?: string; doneLabel?: string;
}) {
  const { pending, error, run } = useAct();
  const router = useRouter();
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={className} disabled={pending || done}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          run(action, () => {
            if (doneLabel) setDone(true);
            if (href) router.push(href);
            router.refresh();
          });
        }}>
        {done ? doneLabel : pending ? t("common.wait") : label}
      </button>
      <ErrorText>{error}</ErrorText>
    </span>
  );
}

export function CopyButton({ text, label, className = "btn-secondary btn-sm" }: { text: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={className}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch {
          const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        }
        setOk(true); setTimeout(() => setOk(false), 1800);
      }}>
      {ok ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
      <span aria-live="polite">{ok ? t("common.copied") : label ?? t("common.copy")}</span>
    </button>
  );
}

/** Paylaşım her zaman kullanıcı tarafından başlatılır: WhatsApp'ı hazır metinle açar, otomatik mesaj göndermez. */
export function ShareRow({ text, groupId }: { text: string; groupId?: string }) {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && !!navigator.share), []);
  const track = (via: string) => { if (groupId) void inviteSharedAction(groupId, via); };
  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn-primary flex-1" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`} onClick={() => track("whatsapp")}>
        {t("share.whatsapp")}
      </a>
      {canShare && (
        <button type="button" className="btn-secondary" onClick={() => { track("system"); void navigator.share({ text }).catch(() => {}); }}>
          <Share2 aria-hidden className="h-4 w-4" /> {t("share.other")}
        </button>
      )}
      <span onClick={() => track("copy")}><CopyButton text={text} className="btn-secondary" /></span>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-0 mt-auto w-full max-w-xl rounded-t-3xl bg-paper p-0 text-ink sm:m-auto sm:rounded-3xl" style={{ maxHeight: "92dvh", marginInline: "auto" }}>
      <div className="flex max-h-[92dvh] flex-col">
        <div className="row border-b border-paper-line px-4 py-3">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid h-10 w-10 place-items-center rounded-full hover:bg-brand-50"><X aria-hidden className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-4 pb-8 pt-4">{open && children}</div>
      </div>
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted mt-1 block text-xs">{hint}</span>}
    </label>
  );
}
