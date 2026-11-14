import Link from "next/link";
import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brand } from "@/config/brand";
import { t } from "@/lib/i18n";

const DOCS = { privacy: "privacy.md", terms: "terms.md", kvkk: "kvkk.md" } as const;
export function generateStaticParams() { return Object.keys(DOCS).map((doc) => ({ doc })); }

/** Düzenlenebilir hukuki metin taslakları: src/content/legal/*.md. Basit markdown (başlık, paragraf, liste). */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const file = DOCS[doc as keyof typeof DOCS];
  if (!file) notFound();
  const md = (await readFile(join(process.cwd(), "src/content/legal", file), "utf8")).replaceAll("{{brand}}", brand.name).replaceAll("{{email}}", brand.supportEmail);
  const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <main className="mx-auto max-w-xl px-5 pb-16 pt-8">
      <Link href="/" className="text-lg font-extrabold tracking-tight text-brand-700">{brand.name}</Link>
      <div className="mt-4 rounded-xl border border-warm-600/40 bg-warm-50 px-3.5 py-3 text-sm font-medium text-warm-700">{t("legal.draftBanner")}</div>
      <article className="mt-5 grid gap-3 text-[15px] leading-relaxed">
        {blocks.map((b, i) =>
          b.startsWith("# ") ? <h1 key={i}>{b.slice(2)}</h1>
          : b.startsWith("## ") ? <h2 key={i} className="mt-3">{b.slice(3)}</h2>
          : b.startsWith("- ") ? <ul key={i} className="list-disc pl-5">{b.split("\n").map((l, j) => <li key={j}>{l.replace(/^- /, "")}</li>)}</ul>
          : <p key={i}>{b}</p>)}
      </article>
    </main>
  );
}
