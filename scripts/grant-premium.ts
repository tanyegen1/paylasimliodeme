/** Geliştirme/destek aracı: npm run premium:grant -- kisi@example.com. Abonelik satın alma taklidi DEĞİLDİR. */
import { loadEnv } from "./_env";
loadEnv();
void (async () => {
  const { pool } = await import("../src/server/db");
  const email = process.argv[2];
  if (!email) throw new Error("Kullanım: npm run premium:grant -- <e-posta>");
  const u = await pool.query(`select id from users where lower(email)=lower($1)`, [email]);
  if (!u.rowCount) throw new Error("Kullanıcı bulunamadı");
  await pool.query(`insert into entitlements (user_id, plan, source) values ($1,'premium','manual_grant')`, [u.rows[0].id]);
  console.log("Premium tanımlandı:", email);
  await pool.end();
})();
