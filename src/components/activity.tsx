import Link from "next/link";
import type { ActivityRow } from "@/server/activity";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { t, tDyn } from "@/lib/i18n";

const ICON: Record<string, string> = {
  "expense.created": "🧾", "expense.updated": "✏️", "expense.deleted": "🗑️", "expense.restored": "↩️", "expense.correction_requested": "💬",
  "member.joined": "👋", "member.left": "🚪", "member.removed": "🚪", "member.placeholder_added": "➕", "claim.approved": "✅", "group.created": "✨",
  "payment_request.created": "📨", "manual_payment.reported": "📤", "manual_payment.confirmed": "✅", "manual_payment.rejected": "↩️",
  "payment_attempt.succeeded": "✅", "payment_attempt.failed": "⚠️", "payment_attempt.reversed": "↩️", "payment.reversed": "↩️",
  "receipt.finalized": "🧾", "receipt.reopened": "🔓", "recurring.created": "🔁", "recurring.stopped": "⏸️", "group.settings_updated": "⚙️",
};

export function describe(row: ActivityRow): string {
  const d = row.data as { title?: string; amount_minor?: number; currency?: string; after?: { title?: string; amount_minor?: number; currency?: string } };
  const src = d.after ?? d;
  const amount = typeof src.amount_minor === "number" && src.currency ? formatMoney(src.amount_minor, src.currency) : "";
  return tDyn(`activity.${row.type.replace(/\./g, "_")}`, row.type, { actor: row.actor_name ?? t("activity.system"), title: src.title ?? "", amount });
}

export function ActivityList({ rows, showGroup = false }: { rows: ActivityRow[]; showGroup?: boolean }) {
  return (
    <ul className="card divide-y divide-paper-line p-0">
      {rows.map((r) => {
        const href = r.type.startsWith("expense.") && r.entity_id ? `/groups/${r.group_id}/expenses/${r.entity_id}` : `/groups/${r.group_id}`;
        return (
          <li key={r.id}>
            <Link href={href} className="flex items-start gap-3 px-4 py-3">
              <span aria-hidden className="mt-0.5 text-lg">{ICON[r.type] ?? "•"}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block">{describe(r)}</span>
                <span className="muted text-xs">{showGroup ? `${r.group_name} · ` : ""}{formatDateTime(r.created_at)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
