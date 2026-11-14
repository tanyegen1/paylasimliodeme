import "server-only";
import { expireRequests } from "./payments";
import { runRecurring } from "./recurring";
import { runReminders } from "./reminders";
import { pool } from "./db";

/** Tüm zamanlanmış işler. Tekrar çalıştırılması güvenlidir (idempotent). */
export async function runJobs() {
  await expireRequests();
  const recurring = await runRecurring();
  const reminders = await runReminders();
  await pool.query(`delete from sessions where expires_at < now()`);
  await pool.query(`delete from webhook_events where received_at < now() - interval '90 days'`);
  return { recurring, reminders };
}
