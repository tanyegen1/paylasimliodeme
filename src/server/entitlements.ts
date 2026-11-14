import "server-only";
import { q1, pool } from "./db";
import { AppError } from "./errors";
import { PLANS, type PlanId } from "@/config/plans";

export async function userPlan(userId: string): Promise<PlanId> {
  const r = await q1(`select 1 from entitlements where user_id=$1 and plan='premium' and (valid_until is null or valid_until > now()) limit 1`, [userId]);
  return r ? "premium" : "free";
}
/** Grup içinde geçerli plan: kullanıcının kendi planı ya da grubu kuranın planı (hangisi yüksekse). */
export async function planInGroup(userId: string, groupId: string): Promise<PlanId> {
  if ((await userPlan(userId)) === "premium") return "premium";
  const g = await q1(`select created_by from groups where id=$1`, [groupId]);
  return g?.created_by ? userPlan(g.created_by) : "free";
}
export async function consumeQuota(userId: string, groupId: string, feature: "ocr" | "nl") {
  const plan = PLANS[await planInGroup(userId, groupId)];
  const limit = feature === "ocr" ? plan.ocrScansPerMonth : plan.nlDraftsPerMonth;
  const period = new Date().toISOString().slice(0, 7);
  const r = await pool.query(
    `insert into usage_counters (user_id, feature, period, count) values ($1,$2,$3,1)
     on conflict (user_id, feature, period) do update set count = usage_counters.count + 1 where usage_counters.count < $4 returning count`,
    [userId, feature, period, limit]);
  if (!r.rowCount) throw new AppError("quota_exceeded", 402);
}
export async function usage(userId: string) {
  const period = new Date().toISOString().slice(0, 7);
  const rows = (await pool.query(`select feature, count from usage_counters where user_id=$1 and period=$2`, [userId, period])).rows;
  return Object.fromEntries(rows.map((r) => [r.feature, r.count])) as Record<string, number>;
}
