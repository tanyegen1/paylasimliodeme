import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";

export function Page({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-xl px-4 pb-32 pt-5 ${className}`}>{children}</main>;
}
export function Header({ title, back, action, subtitle }: { title: string; back?: string; action?: React.ReactNode; subtitle?: string }) {
  return (
    <header className="mb-4 flex items-start gap-2">
      {back && (
        <Link href={back} aria-label={t("common.back")} className="-ml-2 mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-brand-50">
          <ChevronLeft aria-hidden className="h-6 w-6" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate">{title}</h1>
        {subtitle && <p className="muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const hues = ["bg-brand-100 text-brand-800", "bg-warm-50 text-warm-700", "bg-sky-100 text-sky-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % hues.length;
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-bold ${hues[h]} ${size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm"}`}>
      {name.trim().charAt(0).toLocaleUpperCase("tr")}
    </span>
  );
}
/**
 * Net bakiye gösterimi. Anlam yalnızca renkle değil, metin etiketiyle de verilir
 * ("Alacağın" / "Borcun" / "Ödeşik").
 */
export function BalanceText({ net, currency, mine = true, className = "" }: { net: number; currency: string; mine?: boolean; className?: string }) {
  if (net === 0) return <span className={`text-ink-mute ${className}`}>{t("balance.settled")}</span>;
  const label = net > 0 ? (mine ? t("balance.youAreOwed") : t("balance.isOwed")) : mine ? t("balance.youOwe") : t("balance.owes");
  return (
    <span className={`${net > 0 ? "text-brand-700" : "text-warm-700"} ${className}`}>
      <span className="text-xs font-medium">{label} </span>
      <span className="font-bold">{formatMoney(Math.abs(net), currency)}</span>
    </span>
  );
}
export function Empty({ icon, title, body, children }: { icon?: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="card grid place-items-center gap-2 py-8 text-center">
      {icon && <div className="text-3xl" aria-hidden>{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <p className="muted max-w-xs">{body}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
const TONES = {
  neutral: "bg-slate-100 text-slate-700", ok: "bg-brand-50 text-brand-800", warn: "bg-warm-50 text-warm-700", bad: "bg-danger-50 text-danger-600", info: "bg-sky-50 text-sky-800",
} as const;
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}
export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "ok"; children: React.ReactNode; title?: string }) {
  const c = tone === "warn" ? "border-warm-600/30 bg-warm-50 text-warm-700" : tone === "ok" ? "border-brand-600/30 bg-brand-50 text-brand-800" : "border-sky-600/20 bg-sky-50 text-sky-900";
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-sm ${c}`}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
