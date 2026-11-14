"use client";

import { useState } from "react";
import { sandboxDecideAction } from "@/app/actions";
import { ErrorText, useAct } from "@/components/client";
import { t } from "@/lib/i18n";

export function SandboxButtons({ providerRef, status }: { providerRef: string; status: string }) {
  const { pending, error, run } = useAct();
  const [msg, setMsg] = useState<string | null>(null);
  const go = (o: "succeeded" | "failed" | "reversed") => run(() => sandboxDecideAction(providerRef, o), (d) => { setMsg(d.delivered ? t("sandbox.delivered") : t("sandbox.notDelivered")); setTimeout(() => window.history.length > 1 ? window.history.back() : window.location.reload(), 900); });
  return (
    <div className="mt-5 grid gap-2">
      {status === "initiated" && <><button className="btn-primary" disabled={pending} onClick={() => go("succeeded")}>{t("sandbox.approve")}</button><button className="btn-secondary" disabled={pending} onClick={() => go("failed")}>{t("sandbox.decline")}</button></>}
      {status === "succeeded" && <button className="btn-danger" disabled={pending} onClick={() => go("reversed")}>{t("sandbox.reverse")}</button>}
      {msg && <p role="status" className="text-sm font-semibold">{msg}</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
