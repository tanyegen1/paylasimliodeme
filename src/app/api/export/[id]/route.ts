import { getUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { listExpenses } from "@/server/expenses";
import { planInGroup } from "@/server/entitlements";
import { q } from "@/server/db";
import { PLANS } from "@/config/plans";
import { minorToInput } from "@/lib/money";

const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // elektronik tabloda formül çalıştırmayı engelle
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return new Response("Giriş gerekli", { status: 401 });
  try {
    const ctx = await getGroupContext(id, user.id);
    if (!PLANS[await planInGroup(user.id, id)].export) return new Response("Dışa aktarım premium özelliğidir.", { status: 402 });
    const month = new URL(req.url).searchParams.get("m");
    const name = (m: string) => ctx.members.find((x) => x.id === m)?.display_name ?? "?";
    const expenses = (await listExpenses(id, user.id)).filter((e) => e.status === "active" && (!month || e.expense_date.startsWith(month)));
    const allocs = await q(`select a.expense_id, a.member_id, a.amount_minor from expense_allocations a join expenses e on e.id=a.expense_id where e.group_id=$1`, [id]);
    const members = ctx.members;
    const head = ["Tarih", "Başlık", "Kategori", "Tutar", "Para birimi", "Ödeyen", ...members.map((m) => `Pay: ${m.display_name}`)];
    const rows = expenses.map((e) => [e.expense_date, e.title, e.category, minorToInput(e.amount_minor), e.currency, e.payer_names.join(" + "),
      ...members.map((m) => { const a = allocs.find((x) => x.expense_id === e.id && x.member_id === m.id); return a ? minorToInput(a.amount_minor) : ""; })]);
    const pays = await q(`select created_at, from_member, to_member, amount_minor, currency, source from payments where group_id=$1 and reversed_at is null order by created_at`, [id]);
    const lines = [head, ...rows, [], ["Ödemeler"], ["Tarih", "Kimden", "Kime", "Tutar", "Para birimi", "Durum"],
      ...pays.map((p) => [new Date(p.created_at).toISOString().slice(0, 10), name(p.from_member), name(p.to_member), minorToInput(p.amount_minor), p.currency, p.source === "provider" ? "Ödeme sağlayıcısı tarafından doğrulandı" : "Alıcı tarafından onaylandı"])];
    const csv = "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="payimiz-${month ?? "tum"}.csv"`, "cache-control": "private, no-store" } });
  } catch {
    return new Response("Bulunamadı", { status: 404 });
  }
}
