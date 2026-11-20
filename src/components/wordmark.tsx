import Link from "next/link";
import { brand } from "@/config/brand";
import { LOGO_H, LOGO_W, MARK_ONLY_H, MARK_ONLY_PATH, MARK_ONLY_W, MARK_PATH, TEXT_PATH } from "./logo-paths";

/**
 * Payda logosu (rehber v2.0): açık zeminde kobalt fiş + siyah yazı; koyu zeminde tamamı beyaz.
 * Renkler temadan gelir (--logo-mark, --logo-text). Rehber: yatay logo en az 120 px genişlik.
 */
export function Wordmark({ href = "/", height = 30, className = "" }: { href?: string | null; height?: number; className?: string }) {
  const pad = 4;
  const svg = (
    <svg role="img" aria-label={brand.name} viewBox={`${-pad} ${-pad} ${LOGO_W + pad * 2} ${LOGO_H + pad * 2}`}
      style={{ height, width: "auto", minWidth: 120 }} className={`block ${className}`}>
      <path fillRule="evenodd" d={MARK_PATH} style={{ fill: "rgb(var(--logo-mark))" }} />
      <path fillRule="evenodd" d={TEXT_PATH} style={{ fill: "rgb(var(--logo-text))" }} />
    </svg>
  );
  return href ? <Link href={href} className="inline-flex" aria-label={brand.name}>{svg}</Link> : svg;
}

/** Dar alanlar için yalnızca fiş simgesi. */
export function LogoMark({ size = 28, white = false }: { size?: number; white?: boolean }) {
  return (
    <svg role="img" aria-label={brand.name} viewBox={`0 0 ${MARK_ONLY_W} ${MARK_ONLY_H}`} style={{ width: size, height: "auto" }} className="block">
      <path fillRule="evenodd" d={MARK_ONLY_PATH} style={{ fill: white ? "#fff" : "rgb(var(--logo-mark))" }} />
    </svg>
  );
}
