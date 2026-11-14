import { createGuestUser, registerUser } from "@/server/auth";
import { createGroup, getGroupContext } from "@/server/groups";
import { createInvite, joinViaInvite } from "@/server/invites";
import { createExpense } from "@/server/expenses";
import { computeGroupBalances } from "@/server/ledger";

let n = 0;
export async function user(name: string, full = true) {
  n++;
  return full
    ? registerUser({ name, email: `${name.toLowerCase()}${n}-${Date.now()}@test.local`, password: "parola-12345", termsAccepted: true })
    : createGuestUser({ name, termsAccepted: true });
}

/** Kurucu + davetle katılan tam üyelerden oluşan grup. */
export async function groupWith(names: string[], opts: Record<string, unknown> = {}) {
  const users = [];
  for (const nm of names) users.push(await user(nm));
  const group = await createGroup(users[0].id, { name: "Test grubu", type: "home", currency: "TRY", ...opts });
  const inv = await createInvite(group.id, users[0].id);
  for (const u of users.slice(1)) await joinViaInvite(u.id, inv.token);
  const ctx = await getGroupContext(group.id, users[0].id);
  const m = Object.fromEntries(ctx.members.map((x) => [x.display_name, x.id]));
  return { group, users, m, ids: ctx.members.map((x) => x.id) };
}

export const today = () => new Date().toISOString().slice(0, 10);
export function equalExpense(amount: number, payer: string, memberIds: string[], extra: Record<string, unknown> = {}) {
  return { title: "Harcama", category: "other", amount, currency: "TRY", expenseDate: today(), payers: [{ memberId: payer, amount }], split: { type: "equal", memberIds }, ...extra };
}
export async function addEqual(groupId: string, userId: string, amount: number, payer: string, memberIds: string[]) {
  return createExpense(groupId, userId, equalExpense(amount, payer, memberIds));
}
export async function nets(groupId: string, currency = "TRY") {
  return (await computeGroupBalances(groupId)).nets[currency] ?? {};
}
