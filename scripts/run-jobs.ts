import { loadEnv } from "./_env";
loadEnv();
void (async () => {
  const { runJobs } = await import("../src/server/jobs");
  const { pool } = await import("../src/server/db");
  console.log("İşler çalıştı:", await runJobs());
  await pool.end();
})();
