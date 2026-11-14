import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export async function migrate(url: string, quiet = false) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const dir = join(process.cwd(), "db/migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const done = await client.query("select 1 from schema_migrations where name=$1", [f]);
      if (done.rowCount) continue;
      await client.query("begin");
      await client.query(readFileSync(join(dir, f), "utf8"));
      await client.query("insert into schema_migrations(name) values ($1)", [f]);
      await client.query("commit");
      if (!quiet) console.log("uygulandı:", f);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  void (async () => {
    const { loadEnv } = await import("./_env");
    loadEnv();
    await migrate(process.env.DATABASE_URL!);
    console.log("Migration tamam.");
  })();
}
