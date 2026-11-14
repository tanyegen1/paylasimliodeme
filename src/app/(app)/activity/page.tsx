import Link from "next/link";
import { requireUser } from "@/server/session";
import { listNotifications, userActivity } from "@/server/activity";
import { ActivityList } from "@/components/activity";
import { ActButton } from "@/components/client";
import { Empty, Header, Page } from "@/components/ui";
import { markReadAction } from "@/app/actions";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { t, tDyn } from "@/lib/i18n";

export const metadata = { title: "Hareketler" };

export default async function ActivityPage() {
  const user = await requireUser("/activity");
  const [notes, rows] = await Promise.all([listNotifications(user.id), userActivity(user.id)]);
  const text = (n: (typeof notes)[number]) => {
    const d = n.data as Record<string, string | number | undefined>;
    return tDyn(`notif.${n.type}`, n.type, {
      amount: typeof d.amount_minor === "number" ? formatMoney(d.amount_minor, String(d.currency ?? "TRY")) : "", by: String(d.by ?? ""), to: String(d.to ?? ""), group: String(d.group ?? ""),
      title: String(d.title ?? ""), name: String(d.name ?? ""), placeholder: String(d.placeholder ?? ""), date: d.date ? formatDate(String(d.date)) : "",
    });
  };
  const href = (n: (typeof notes)[number]) => {
    if (!n.group_id) return "/";
    const d = n.data as { expenseId?: string };
    if (d.expenseId) return `/groups/${n.group_id}/expenses/${d.expenseId}`;
    if (n.type.startsWith("claim")) return `/groups/${n.group_id}?tab=members`;
    if (n.type === "reminder") return `/groups/${n.group_id}?tab=balances`;
    return n.type.startsWith("payment") || n.type.startsWith("date") ? `/groups/${n.group_id}?tab=payments` : `/groups/${n.group_id}`;
  };
  const unread = notes.some((n) => !n.read_at);
  return (
    <Page>
      <Header title={t("activityPage.title")} />
      {notes.length > 0 && (
        <>
          <div className="row mb-2"><h2 className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t("activityPage.forYou")}</h2>{unread && <ActButton action={markReadAction} label={t("activityPage.markRead")} className="btn-ghost btn-sm" />}</div>
          <ul className="card mb-6 divide-y divide-paper-line p-0">
            {notes.slice(0, 15).map((n) => (
              <li key={n.id}><Link href={href(n)} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-warm-600"}`} />
                <span className="flex-1"><span className={n.read_at ? "" : "font-semibold"}>{text(n)}</span>{!n.read_at && <span className="sr-only"> ({t("nav.unread")})</span>}<span className="muted block text-xs">{formatDateTime(n.created_at)}</span></span>
              </Link></li>
            ))}
          </ul>
        </>
      )}
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">{t("activityPage.all")}</h2>
      {rows.length === 0 ? <Empty icon="🕊️" title={t("activityPage.emptyTitle")} body={t("activityPage.emptyBody")} /> : <ActivityList rows={rows} showGroup />}
    </Page>
  );
}
