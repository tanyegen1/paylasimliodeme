import Link from "next/link";
import { brand } from "@/config/brand";

/** Marka yazısı: ilk harf yeşil (tema vurgu rengi), kalanı koyu. Ad config/brand.ts'ten gelir. */
export function Wordmark({ href = "/", className = "" }: { href?: string | null; className?: string }) {
  const [first, rest] = [brand.name.charAt(0), brand.name.slice(1)];
  const inner = (
    <span className={`inline-flex items-baseline text-[1.35rem] font-extrabold tracking-tight ${className}`} aria-label={brand.name}>
      <span aria-hidden className="text-brand-600">{first}</span>
      <span aria-hidden className="text-ink">{rest}</span>
    </span>
  );
  return href ? <Link href={href} className="inline-flex">{inner}</Link> : inner;
}
