import "server-only";

/** Loglarda kişisel/finansal veriyi maskeler. */
const SENSITIVE = /^(iban|iban_holder|email|password|token|display_name|name|title|note|body|amount_minor|amount|authorization|cookie)$/i;
export function mask(v: unknown, depth = 0): unknown {
  if (v == null || depth > 4) return v;
  if (typeof v === "string") {
    return v
      .replace(/TR\d{2}[\s\d]{20,30}/gi, "TR** **** (iban)")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "***@***");
  }
  if (Array.isArray(v)) return v.map((x) => mask(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object)) out[k] = SENSITIVE.test(k) ? "[gizli]" : mask(val, depth + 1);
    return out;
  }
  return v;
}
export const log = {
  info: (msg: string, data?: unknown) => console.log(JSON.stringify({ level: "info", msg, ...(data ? { data: mask(data) } : {}) })),
  warn: (msg: string, data?: unknown) => console.warn(JSON.stringify({ level: "warn", msg, ...(data ? { data: mask(data) } : {}) })),
  error: (msg: string, err?: unknown) =>
    console.error(JSON.stringify({ level: "error", msg, error: err instanceof Error ? mask(err.message) : mask(err) })),
};
