import { existsSync, readFileSync } from "node:fs";

/** .env.local / .env dosyalarını okur (önceden tanımlı ortam değişkenlerini ezmez). */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}
