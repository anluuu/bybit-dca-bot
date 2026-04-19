import { useMutation } from "@tanstack/react-query";
import {
  Send,
  CircleCheck,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface PingResult {
  ok: boolean;
  sentAt: string;
}

async function postJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: "{}",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function TelegramPingCard() {
  const { t } = useTranslation();

  const ping = useMutation<PingResult, Error, void>({
    mutationFn: () => postJson<PingResult>("/api/admin/telegram/ping"),
  });

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <Send className="h-4 w-4 text-violet-tech" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("telegramPing.title")}
        </h2>
        <span className="ml-auto rounded-md border border-violet-tech/20 bg-violet-tech/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet-tech">
          {t("telegramPing.operatorOnly")}
        </span>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-surface-400">
        {t("telegramPing.description")}
      </p>

      <button
        onClick={() => ping.mutate()}
        disabled={ping.isPending}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-violet-tech/40 bg-violet-tech/10 px-4 py-2.5 text-sm font-medium text-violet-tech transition-all hover:border-violet-tech/60 hover:bg-violet-tech/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {ping.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("telegramPing.sending")}
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            {t("telegramPing.sendTest")}
          </>
        )}
      </button>

      {ping.isSuccess && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-gain/30 bg-green-gain/10 px-3 py-2.5">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-gain" />
          <div>
            <p className="text-xs font-medium text-green-gain">
              {t("telegramPing.sent")}
            </p>
            <p className="mt-0.5 text-xs text-green-gain/70">
              {t("telegramPing.checkChat")}
            </p>
          </div>
        </div>
      )}

      {ping.isError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-loss/30 bg-red-loss/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-loss" />
          <div>
            <p className="text-xs font-medium text-red-loss">
              {t("telegramPing.failed")}
            </p>
            <p className="mt-0.5 text-xs text-red-loss/70">
              {ping.error.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
