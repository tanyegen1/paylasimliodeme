import "server-only";
import { Pool, type PoolClient, types } from "pg";
import { env } from "./env";

// BIGINT (kuruş) → number. Tutarlar MAX_MINOR ile sınırlı olduğundan güvenli tam sayı aralığındadır.
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("bigint out of safe range");
  return n;
});
// DATE → "YYYY-AA-GG" metni (saat dilimi kayması olmasın).
types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __pool?: Pool };
export const pool = (g.__pool ??= new Pool({ connectionString: env.databaseUrl, max: 10 }));

export type Db = { query: PoolClient["query"] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export async function q<T extends Row = Row>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
export async function q1<T extends Row = Row>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  return (await q<T>(sql, params, db))[0] ?? null;
}

export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
