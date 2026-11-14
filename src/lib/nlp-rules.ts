/**
 * Türkçe serbest metinden harcama taslağı çıkaran KURAL TABANLI ayrıştırıcı.
 * Dış servis gerektirmez. Emin olamadığı yerde tahmin yürütmez; soru üretir.
 * Metin güvenilmeyen veridir: yalnızca tutar/isim/anahtar sözcük okunur, hiçbir talimat yürütülmez.
 */
import { parseMoney } from "./money";
import type { Category } from "./categories";

export type NlDraft = {
  title: string;
  category: Category;
  amountMinor: number | null;
  currency: string | null;
  payerName: string | null;          // "ben" = yazan kişi
  participantNames: string[] | null; // null = belirtilmedi
  participantCount: number | null;
  everyone: boolean;
  exclusions: { names: string[]; amountMinor: number; label: string }[];
  questions: string[];
};

const lower = (s: string) => s.toLocaleLowerCase("tr");
const CUR: [RegExp, string][] = [[/^(tl|lira|₺)/, "TRY"], [/^(euro|eur|avro|€)/, "EUR"], [/^(dolar|usd|\$)/, "USD"], [/^(sterlin|gbp|pound|£)/, "GBP"]];
const AMOUNT_RE = /(\d[\d.]*(?:,\d{1,2})?)\s*(tl|lira|₺|euro|eur|avro|€|dolar|usd|\$|sterlin|gbp|pound|£)/gi;
const COUNT_WORDS: Record<string, number> = { iki: 2, "üç": 3, "dört": 4, "beş": 5, "altı": 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10 };
const COLLECTIVE: [RegExp, number][] = [[/\bikimiz/, 2], [/\büçümüz/, 3], [/\bdördümüz/, 4], [/\bbeşimiz/, 5], [/\baltımız/, 6], [/\byedimiz/, 7], [/\bsekizimiz/, 8]];
const CATEGORY_WORDS: [RegExp, Category, string][] = [
  [/\bkira/, "rent", "Kira"], [/\binternet|\bwifi/, "internet", "İnternet"],
  [/\belektri[kğ]|\bdoğalgaz|\bfatura|\bsu faturası|\baidat/, "utilities", "Fatura"],
  [/\bmarket|\bbakkal|\bmanav/, "groceries", "Market"],
  [/\byeme[kğ]|\brestoran|\blokanta|\bkahvaltı|\bkahve|\bpizza|\bmeyhane|\bhesa[bp]/, "food", "Yemek"],
  [/\btaksi|\bbenzin|\buber|\botobüs|\buçak|\bbilet|\byakıt|\botopark/, "transport", "Ulaşım"],
  [/\botel|\bkonaklama|\bairbnb|\bpansiyon|\bvilla/, "lodging", "Konaklama"],
  [/\bsinema|\bkonser|\btiyatro|\bmüze|\btekne/, "fun", "Eğlence"],
  [/\beczane|\bilaç/, "health", "Sağlık"],
];
const EXCLUDE_RE = /yazma|hariç|dahil etme|dahil değil|katma|sayma|ödemesin|alma(?:sın|yın)?\b|dışında/;

function findNames(clause: string, memberNames: string[]): string[] {
  const lc = lower(clause);
  const out: string[] = [];
  for (const name of memberNames) {
    const first = lower(name.split(/\s+/)[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (first.length < 2) continue;
    if (new RegExp(`(^|[^\\p{L}])${first}(['’]\\p{L}+|\\p{L}{0,4})?(?=$|[^\\p{L}])`, "u").test(lc)) out.push(name);
  }
  return out;
}
/** Bilinen üyelerle eşleşmeyen, ek almış özel isimler (ör. "Deniz'e"). */
function unknownNames(clause: string, known: string[]): string[] {
  const knownFirst = new Set(known.map((n) => lower(n.split(/\s+/)[0])));
  const out: string[] = [];
  for (const m of clause.matchAll(/(\p{Lu}\p{Ll}+)['’]\p{Ll}+/gu)) if (!knownFirst.has(lower(m[1]))) out.push(m[1]);
  return out;
}

export function parseExpenseText(text: string, memberNames: string[]): NlDraft {
  const raw = text.slice(0, 600).replace(/\s+/g, " ").trim();
  const lc = lower(raw);
  const draft: NlDraft = { title: "", category: "other", amountMinor: null, currency: null, payerName: null, participantNames: null, participantCount: null, everyone: false, exclusions: [], questions: [] };

  const clauses = raw.split(/[.;!?](?=\s|$)| ama | fakat | ancak | yalnız | sadece /i).map((c) => c.trim()).filter(Boolean);
  const amounts: { minor: number; cur: string; clause: number }[] = [];
  clauses.forEach((c, i) => {
    for (const m of c.matchAll(AMOUNT_RE)) {
      const minor = parseMoney(m[1]);
      const cur = CUR.find(([re]) => re.test(lower(m[2])))?.[1] ?? "TRY";
      if (minor != null && minor > 0) amounts.push({ minor, cur, clause: i });
    }
  });

  // İstisna cümleleri
  clauses.forEach((c, i) => {
    if (!EXCLUDE_RE.test(lower(c))) return;
    const names = findNames(c, memberNames);
    const unknown = unknownNames(c, memberNames);
    const amt = amounts.find((a) => a.clause === i);
    if (unknown.length) draft.questions.push(`"${unknown[0]}" grupta kim? Üyeler arasında bulamadım.`);
    if (!names.length && !unknown.length) draft.questions.push("Kimi hariç tutmak istediğini anlayamadım. İsmini yazar mısın?");
    else if (names.length && !amt) draft.questions.push(`${names.join(", ")} için hariç tutulacak tutar ne kadar? (Tamamen hariçse katılımcılardan çıkarabilirsin.)`);
    else if (names.length && amt) {
      const label = lower(c).match(/([\p{L}]+(?: [\p{L}]+)?)\s*(?:nın|nin|nun|nün|ın|in|un|ün)\s+\d/u)?.[1] ?? "Hariç tutulan kısım";
      draft.exclusions.push({ names, amountMinor: amt.minor, label: label.charAt(0).toLocaleUpperCase("tr") + label.slice(1) });
    }
  });

  const exclClauses = new Set(clauses.map((c, i) => (EXCLUDE_RE.test(lower(c)) ? i : -1)));
  const main = amounts.filter((a) => !exclClauses.has(a.clause));
  if (main.length === 1) {
    draft.amountMinor = main[0].minor;
    draft.currency = main[0].cur;
  } else if (main.length > 1) {
    draft.amountMinor = Math.max(...main.map((a) => a.minor));
    draft.currency = main[0].cur;
    draft.questions.push("Birden fazla tutar gördüm. Toplam tutarı doğrular mısın?");
  } else {
    const bare = raw.match(/(?:^|\s)(\d[\d.]*(?:,\d{1,2})?)(?=\s|$)/);
    const minor = bare ? parseMoney(bare[1]) : null;
    if (minor) {
      draft.amountMinor = minor;
      draft.questions.push("Tutarın para birimini göremedim; grup para birimini varsaydım. Doğru mu?");
    } else draft.questions.push("Toplam tutar ne kadar?");
  }

  // Ödeyen
  if (/\b(verdim|ödedim|aldım|yaptım|ısmarladım)\b|\bben (ödedim|verdim)/.test(lc)) draft.payerName = "ben";
  else {
    const pm = raw.match(/(\p{Lu}\p{Ll}+)(?:['’]\p{Ll}+)?\s+(?:\S+\s+){0,3}?(ödedi|verdi|aldı|ısmarladı)(?=$|[^\p{L}])/u);
    if (pm) draft.payerName = findNames(pm[1], memberNames)[0] ?? pm[1];
  }
  if (!draft.payerName) draft.questions.push("Kim ödedi?");

  // Katılımcılar
  const mainText = clauses.filter((_, i) => !exclClauses.has(i)).join(". ");
  const mainLc = lower(mainText);
  if (/\bhepimiz|\bherkes|\bhep beraber|\bherkese/.test(mainLc)) draft.everyone = true;
  for (const [re, n] of COLLECTIVE) if (re.test(mainLc)) draft.participantCount = n;
  const cm = mainLc.match(/(\d+|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s+kişi/);
  if (cm) draft.participantCount = COUNT_WORDS[cm[1]] ?? Number(cm[1]);
  const named = findNames(mainText, memberNames).filter((n) => n !== draft.payerName);
  if (named.length && /arasında|ile|beraber|birlikte|ve ben|bölüş|böl/.test(mainLc) && !draft.everyone && !draft.participantCount) draft.participantNames = named;

  for (const [re, cat, title] of CATEGORY_WORDS) {
    if (re.test(lc)) {
      draft.category = cat;
      draft.title = title;
      break;
    }
  }
  if (!draft.title) draft.title = raw.split(/[.;,](?=\s|$)/)[0].slice(0, 40) || "Harcama";
  return draft;
}

/** Başlıktan kategori tahmini (formda yalnızca varsayılanı seçmek için). */
export function guessCategory(text: string): Category | null {
  const lc = lower(text);
  return CATEGORY_WORDS.find(([re]) => re.test(lc))?.[1] ?? null;
}
