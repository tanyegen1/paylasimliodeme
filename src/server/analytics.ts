import "server-only";
import { env } from "./env";
import { pool } from "./db";
import { pseudonym } from "./tokens";
import { log } from "./log";

export type EventName =
  | "group_created" | "invite_shared" | "invite_opened" | "member_joined"
  | "first_expense_created" | "expense_created" | "receipt_scan_started" | "receipt_scan_confirmed"
  | "payment_request_created" | "payment_started" | "payment_verified" | "payment_failed"
  | "manual_payment_reported" | "manual_payment_confirmed" | "reminder_sent" | "group_settled";

/** Yalnızca bu anahtarlar gönderilir. İsim, IBAN, açıklama, fiş içeriği ASLA eklenmez. */
const ALLOWED = new Set(["group_type", "split_type", "currency", "amount_minor", "member_count", "payer_count", "item_count", "source", "provider", "kind", "via", "has_receipt", "reason"]);

export function sanitizeProps(props: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && /^[a-z0-9_]{1,32}$/i.test(v)) out[k] = v;
  }
  return out;
}

export async function track(name: EventName, ctx: { userId?: string | null; groupId?: string | null }, props: Record<string, unknown> = {}) {
  try {
    const clean = sanitizeProps(props);
    const actor = ctx.userId ? pseudonym(ctx.userId) : null;
    const group = ctx.groupId ? pseudonym(ctx.groupId) : null;
    if (env.analyticsProvider === "none") return;
    await pool.query(`insert into analytics_events (name, actor_hash, group_hash, props) values ($1,$2,$3,$4)`, [name, actor, group, JSON.stringify(clean)]);
    if (env.analyticsProvider === "amplitude" && env.amplitudeKey) {
      // Amplitude HTTP V2 API. Ağ hatası ürünü etkilemez.
      void fetch("https://api2.amplitude.com/2/httpapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.amplitudeKey,
          events: [{ event_type: name, user_id: actor ?? undefined, device_id: actor ? undefined : "anonymous-server", event_properties: clean, groups: group ? { group: group } : undefined, time: Date.now() }],
        }),
      }).catch(() => {});
    }
  } catch (err) {
    log.warn("analytics_failed", { name, err: String(err) });
  }
}
