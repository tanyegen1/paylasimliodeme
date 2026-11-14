import "server-only";
import { type Db, pool } from "./db";

export type NotifCategory = "reminders" | "payment_updates" | "group_activity";

/**
 * Bildirim katmanı. Uygulama içi kanal her zaman çalışır.
 * E-posta / push / WhatsApp Business kanalları sağlayıcı bekliyor (docs/INTEGRATIONS.md);
 * sağlayıcı yokken bu kanallardan gönderilmiş gibi davranılmaz.
 */
export async function notify(
  db: Db | null,
  n: { userId: string | null | undefined; groupId?: string | null; type: string; category: NotifCategory; data?: Record<string, unknown> },
): Promise<boolean> {
  if (!n.userId) return false;
  const d = db ?? pool;
  const pref = await d.query(`select reminders, payment_updates, group_activity from notification_prefs where user_id=$1`, [n.userId]);
  if (pref.rows[0] && pref.rows[0][n.category] === false) return false;
  await d.query(`insert into notifications (user_id, group_id, type, data) values ($1,$2,$3,$4)`, [n.userId, n.groupId ?? null, n.type, JSON.stringify(n.data ?? {})]);
  return true;
}
