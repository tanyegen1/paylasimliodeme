import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";

export function Page({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <main className={`rise mx-auto w-full max-w-xl px-4 pb-36 pt-5 ${className}`}>{children}</main>;
}

export function Header({ title, back, action, subtitle, eyebrow }: { title: string; back?: string; action?: React.ReactNode; subtitle?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <header className="mb-5 flex items-start gap-2">
      {back && (
        <Link href={back} aria-label={t("common.back")} className="-ml-1 mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink-soft shadow-card ring-1 ring-paper-line transition active:scale-95">
          <ChevronLeft aria-hidden className="h-5 w-5" />
        </Link>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        {eyebrow && <div className="mb-1 text-[13px] font-bold text-ink-mute">{eyebrow}</div>}
        <h1 className="truncate">{title}</h1>
        {subtitle && <p className="muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Kişiye özgü, sabit renk. Aynı isim her yerde aynı renkte görünür. */
const AVATAR = [
  "bg-[#D7F3E8] text-[#075442]", "bg-[#FFE6C7] text-[#8F4A06]", "bg-[#DCEBFF] text-[#1D4E89]", "bg-[#EADFFF] text-[#5B2E9E]",
  "bg-[#FFDDE3] text-[#9B1C3A]", "bg-[#D9F2F7] text-[#0E5868]", "bg-[#F4EBC8] text-[#6B5409]", "bg-[#E4E7FF] text-[#3730A3]",
];
export function avatarTone(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
export function Avatar({ name, size = "md", ring = false }: { name: string; size?: "xs" | "sm" | "md" | "lg"; ring?: boolean }) {
  const s = { xs: "h-7 w-7 text-[11px]", sm: "h-9 w-9 text-xs", md: "h-11 w-11 text-sm", lg: "h-14 w-14 text-lg" }[size];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-extrabold ${avatarTone(name)} ${s} ${ring ? "ring-[3px] ring-white" : ""}`}>
      {name.trim().charAt(0).toLocaleUpperCase("tr") || "?"}
    </span>
  );
}
export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="flex -space-x-2" aria-label={names.join(", ")}>
      {shown.map((n, i) => <Avatar key={i} name={n} size="xs" ring />)}
      {names.length > max && <span className="grid h-7 w-7 place-items-center rounded-full bg-paper-sunk text-[11px] font-bold text-ink-soft ring-[3px] ring-white">+{names.length - max}</span>}
    </span>
  );
}

/**
 * Net bakiye. Anlam yalnızca renkle değil, metinle de verilir ("Alacağın" / "Borcun" / "Ödeşik").
 */
export function BalanceText({ net, currency, mine = true, className = "" }: { net: number; currency: string; mine?: boolean; className?: string }) {
  if (net === 0) return <span className={`text-ink-mute ${className}`}>{t("balance.settled")}</span>;
  const label = net > 0 ? (mine ? t("balance.youAreOwed") : t("balance.isOwed")) : mine ? t("balance.youOwe") : t("balance.owes");
  return (
    <span className={`${net > 0 ? "text-brand-700" : "text-warm-700"} ${className}`}>
      <span className="text-xs font-semibold">{label} </span>
      <span className="font-extrabold">{formatMoney(Math.abs(net), currency)}</span>
    </span>
  );
}
/** Küçük, yumuşak durum etiketi (renk + metin). */
export function BalancePill({ net, currency }: { net: number; currency: string }) {
  if (net === 0) return <span className="badge bg-paper-sunk text-ink-mute">{t("balance.settled")}</span>;
  return net > 0
    ? <span className="badge bg-brand-50 text-brand-800">{t("balance.youAreOwed")} {formatMoney(net, currency)}</span>
    : <span className="badge bg-warm-50 text-warm-700">{t("balance.youOwe")} {formatMoney(-net, currency)}</span>;
}

export function Empty({ icon, title, body, children }: { icon?: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="card grid place-items-center gap-2 px-6 py-10 text-center">
      {icon && <div aria-hidden className="mb-1 grid h-20 w-20 animate-pop place-items-center rounded-full bg-gradient-to-br from-brand-50 to-warm-50 text-4xl">{icon}</div>}
      <p className="text-lg font-extrabold">{title}</p>
      {body && <p className="max-w-xs text-[15px] text-ink-mute">{body}</p>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-paper-sunk text-ink-soft", ok: "bg-brand-50 text-brand-800", warn: "bg-warm-50 text-warm-700", bad: "bg-danger-50 text-danger-600", info: "bg-sky-50 text-sky-800",
} as const;
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}
export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "ok"; children: React.ReactNode; title?: string }) {
  const c = tone === "warn" ? "bg-warm-50 text-warm-700 ring-warm-200" : tone === "ok" ? "bg-brand-50 text-brand-800 ring-brand-100" : "bg-sky-50 text-sky-900 ring-sky-100";
  return (
    <div className={`rounded-2xl px-4 py-3.5 text-sm leading-relaxed ring-1 ${c}`}>
      {title && <p className="mb-0.5 font-bold">{title}</p>}
      {children}
    </div>
  );
}

/** Kutlama: kısa, tek seferlik konfeti (hareket azaltma tercihinde gösterilmez). */
export function Celebrate() {
  const bits = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return { x: Math.round(Math.cos(a) * (60 + (i % 3) * 18)), y: Math.round(Math.sin(a) * (50 + (i % 4) * 14)), r: (i * 47) % 360, c: ["#36B38F", "#FFD39A", "#9FDFC8", "#FFB4C2", "#B9D4FF"][i % 5] };
  });
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center motion-reduce:hidden">
      {bits.map((b, i) => (
        <span key={i} className="absolute h-2 w-2 animate-confetti rounded-sm" style={{ background: b.c, ["--x" as string]: `${b.x}px`, ["--y" as string]: `${b.y}px`, ["--r" as string]: `${b.r}deg`, animationDelay: `${i * 12}ms` } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** Kare ikonlu hızlı eylem kutusu. */
export function ActionTile({ href, icon, label, tone = "brand" }: { href: string; icon: React.ReactNode; label: string; tone?: "brand" | "warm" | "sky" | "violet" }) {
  const c = { brand: "bg-brand-50 text-brand-700", warm: "bg-warm-50 text-warm-700", sky: "bg-sky-50 text-sky-700", violet: "bg-violet-50 text-violet-700" }[tone];
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 rounded-2xl py-1 text-center text-[12px] font-bold text-ink-soft transition active:scale-95">
      <span className={`grid h-14 w-14 place-items-center rounded-2xl ${c}`}>{icon}</span>
      <span className="leading-tight">{label}</span>
    </Link>
  );
}
