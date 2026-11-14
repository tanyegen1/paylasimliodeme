import { Client } from "pg";
import { migrate } from "../scripts/migrate";

/** Test veritabanı her çalıştırmada sıfırlanır. Asla geliştirme/demo veritabanını kullanmaz. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://payimiz:payimiz@localhost:5432/payimiz_test";
  if (!/_test(\?|$)/.test(url)) throw new Error("Test veritabanı adı _test ile bitmeli");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("drop schema public cascade; create schema public;");
  await c.end();
  await migrate(url, true);
}
