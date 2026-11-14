"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCommentAction } from "@/app/actions";
import { ErrorText, useAct } from "@/components/client";
import { t } from "@/lib/i18n";

export function CommentForm({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "correction_request">("comment");
  const { pending, error, run } = useAct();
  const router = useRouter();
  return (
    <form className="card grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => addCommentAction(groupId, expenseId, { kind, body }), () => { setBody(""); setKind("comment"); router.refresh(); }); }}>
      <textarea className="input min-h-[72px] py-2.5" aria-label={t("expenseDetail.commentPh")} placeholder={t("expenseDetail.commentPh")} required maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={kind === "correction_request"} onChange={(e) => setKind(e.target.checked ? "correction_request" : "comment")} /><span><b>{t("expenseDetail.asCorrection")}</b><span className="muted block text-xs">{t("expenseDetail.asCorrectionBody")}</span></span></label>
      <ErrorText>{error}</ErrorText>
      <button className="btn-secondary" disabled={pending}>{t("expenseDetail.send")}</button>
    </form>
  );
}
