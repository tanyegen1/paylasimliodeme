import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AvatarStack, Badge, BalancePill } from "@/components/ui";
import { GROUP_EMOJI, GROUP_TILE } from "@/lib/group-types";
import { t } from "@/lib/i18n";

export function GroupCard({ g, nets }: { g: { id: string; name: string; type: string; member_names: string[]; archived_at: Date | null; is_demo: boolean }; nets: Record<string, number> }) {
  const entries = Object.entries(nets);
  return (
    <Link href={`/groups/${g.id}`} className={`card flex items-center gap-3.5 !p-4 transition active:scale-[0.99] ${g.archived_at ? "opacity-60" : ""}`}>
      <span aria-hidden className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl ${GROUP_TILE[g.type]}`}>{GROUP_EMOJI[g.type]}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate text-[16px] font-extrabold">{g.name}</span>{g.is_demo && <Badge tone="warn">DEMO</Badge>}{g.archived_at && <Badge>{t("groups.archived")}</Badge>}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2">
          <AvatarStack names={g.member_names} />
          {entries.length === 0 ? <BalancePill net={0} currency="TRY" /> : entries.map(([c, v]) => <BalancePill key={c} net={v} currency={c} />)}
        </span>
      </span>
      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-ink-faint" />
    </Link>
  );
}

