import "server-only";
import { type Db, pool } from "./db";

export async function audit(
  db: Db,
  e: { groupId?: string | null; userId?: string | null; memberId?: string | null; type: string; entityType?: string; entityId?: string; data?: unknown },
) {
  await (db ?? pool).query(
    `insert into audit_events (group_id, actor_user_id, actor_member_id, type, entity_type, entity_id, data)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [e.groupId ?? null, e.userId ?? null, e.memberId ?? null, e.type, e.entityType ?? null, e.entityId ?? null, JSON.stringify(e.data ?? {})],
  );
}
