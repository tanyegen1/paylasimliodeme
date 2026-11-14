import "server-only";
import { requireMember, type Member } from "./groups";
import { q } from "./db";
import { rateLimit } from "./ratelimit";
import { consumeQuota } from "./entitlements";
import { draftFromText, nlpStatus } from "./providers/ai";
import type { NlDraft } from "@/lib/nlp-rules";
import { validateExpense, type ExpenseInput } from "@/lib/expense-calc";
import { CATEGORIES, type Category } from "@/lib/categories";
import { isCurrency } from "@/lib/money";

const lower = (s: string) => s.toLocaleLowerCase("tr").trim();

function matchMember(name: string, members: Member[], me: Member): { member?: Member; problem?: string } {
  const n = lower(name).replace(/['’].*$/, "");
  if (["ben", "bana", "kendim", "beni", "benim"].includes(n)) return { member: me };
  const exact = members.filter((m) => lower(m.display_name) === n);
  if (exact.length === 1) return { member: exact[0] };
  const first = members.filter((m) => lower(m.display_name).split(/\s+/)[0] === n.split(/\s+/)[0]);
  if (first.length === 1) return { member: first[0] };
  if (first.length > 1) return { problem: `Grupta birden fazla "${name}" var: ${first.map((m) => m.display_name).join(", ")}. Hangisi?` };
  return { problem: `"${name}" adında bir üye bulamadım. Kimi kastettin?` };
}

/**
 * Taslağı grup üyeleriyle eşleştirir, payları SUNUCUDA hesaplar.
 * Belirsizlik varsa harcama girdisi üretmez, kısa sorular döner. Hiçbir şey kaydedilmez.
 */
export function resolveDraft(draft: NlDraft, members: Member[], me: Member, groupCurrency: string, today: string):
  { questions: string[]; input: ExpenseInput | null; shares: { memberId: string; amount: number }[] } {
  const active = members.filter((m) => m.status === "active");
  const questions = [...draft.questions];
  let payer: Member | undefined;
  if (draft.payerName) {
    const r = matchMember(draft.payerName, active, me);
    payer = r.member;
    if (r.problem) questions.push(r.problem);
  }
  let participants: Member[] = active;
  if (draft.participantNames?.length) {
    const found: Member[] = [];
    for (const n of draft.participantNames) {
      const r = matchMember(n, active, me);
      if (r.member) found.push(r.member);
      else if (r.problem) questions.push(r.problem);
    }
    if (payer && !found.includes(payer)) found.unshift(payer);
    participants = [...new Set(found)];
  } else if (draft.participantCount && !draft.everyone && draft.participantCount !== active.length) {
    questions.push(`Grupta ${active.length} kişi var ama ${draft.participantCount} kişiye bölmek istedin. Kimler katılıyor?`);
  }
  const exclusions: { ids: Set<string>; amount: number; label: string }[] = [];
  for (const ex of draft.exclusions) {
    const ids = new Set<string>();
    for (const n of ex.names) {
      const r = matchMember(n, active, me);
      if (r.member) ids.add(r.member.id);
      else if (r.problem) questions.push(r.problem);
    }
    if (ids.size) exclusions.push({ ids, amount: ex.amountMinor, label: ex.label });
  }
  const amount = draft.amountMinor;
  const exclTotal = exclusions.reduce((a, e) => a + e.amount, 0);
  if (amount != null && exclTotal > amount) questions.push("Hariç tutulan tutarlar toplamdan büyük görünüyor. Tutarları kontrol eder misin?");
  for (const ex of exclusions) if (participants.every((p) => ex.ids.has(p.id))) questions.push(`"${ex.label}" kimseye yazılamıyor; en az bir kişi kalmalı.`);
  const uniq = [...new Set(questions)].slice(0, 5);
  if (uniq.length || amount == null || !payer || !participants.length) return { questions: uniq.length ? uniq : ["Eksik bilgi var; biraz daha ayrıntı yazar mısın?"], input: null, shares: [] };

  const ids = participants.map((p) => p.id);
  const category: Category = (CATEGORIES as readonly string[]).includes(draft.category) ? draft.category : "other";
  const input: ExpenseInput = {
    title: draft.title || "Harcama", category, amount, currency: draft.currency && isCurrency(draft.currency) ? draft.currency : groupCurrency,
    expenseDate: today, payers: [{ memberId: payer.id, amount }], note: null,
    split: exclusions.length
      ? {
          type: "itemized", discount: 0, service: 0, tip: 0, extrasMode: "proportional",
          items: [
            ...(amount - exclTotal > 0 ? [{ name: "Ortak kısım", amount: amount - exclTotal, claims: ids.map((memberId) => ({ memberId, weight: 1 })) }] : []),
            ...exclusions.map((e) => ({ name: e.label, amount: e.amount, claims: ids.filter((i) => !e.ids.has(i)).map((memberId) => ({ memberId, weight: 1 })) })),
          ],
        }
      : { type: "equal", memberIds: ids },
  };
  const shares = validateExpense(input);
  return { questions: [], input, shares: shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) };
}

/** Metinden (yazı ya da tarayıcıda çözülmüş konuşma) harcama taslağı. Kayıt için kullanıcının ayrıca onaylaması gerekir. */
export async function draftExpenseFromText(groupId: string, userId: string, text: string) {
  const me = await requireMember(groupId, userId);
  rateLimit(`nl:${userId}`, 20, 60);
  const clean = (text ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600);
  if (clean.length < 3) return { questions: ["Harcamayı bir cümleyle yazar mısın? Örn: “Markete 1.240 lira verdim, dördümüze böl.”"], input: null, shares: [], provider: nlpStatus() };
  await consumeQuota(userId, groupId, "nl");
  const members = await q<Member>(`select * from members where group_id=$1 order by position, joined_at`, [groupId]);
  const g = (await q(`select currency from groups where id=$1`, [groupId]))[0];
  const draft = await draftFromText(clean, members.filter((m) => m.status === "active").map((m) => m.display_name));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  return { ...resolveDraft(draft, members, me, g.currency, today), provider: nlpStatus() };
}
