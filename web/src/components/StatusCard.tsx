import {
  Activity,
  CircleCheck,
  CircleX,
  Clock,
  Database,
  Server,
} from "lucide-react";
import type { HealthStatus, Asset } from "../lib/api.ts";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getNextSunday(): string {
  const now = new Date();
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilSunday);
  next.setUTCHours(8, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
}

interface StatusCardProps {
  health: HealthStatus;
  asset: Asset | undefined;
}

export function StatusCard({ health, asset }: StatusCardProps) {
  const isHealthy = health.status === "ok";

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          Bot Status
        </h2>
      </div>

      {/* Status indicator */}
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex h-3 w-3">
          {isHealthy && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-gain opacity-40" />
          )}
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${isHealthy ? "bg-green-gain" : "bg-red-loss"}`}
          />
        </div>
        <span className="font-mono text-sm font-medium text-surface-100">
          {isHealthy ? "Running" : "Degraded"}
        </span>
        <span className="ml-auto font-mono text-xs text-surface-400">
          uptime {formatUptime(health.uptime)}
        </span>
      </div>

      {/* Services */}
      <div className="mb-5 space-y-2">
        <ServiceRow
          icon={<Database className="h-3.5 w-3.5" />}
          label="PostgreSQL"
          status={health.postgres ?? "unknown"}
        />
        <ServiceRow
          icon={<Server className="h-3.5 w-3.5" />}
          label="Redis"
          status={health.redis ?? "unknown"}
        />
      </div>

      {/* Next buy */}
      <div className="rounded-lg border border-surface-700/30 bg-surface-800/50 p-3">
        <div className="flex items-center gap-2 text-xs text-surface-400">
          <Clock className="h-3.5 w-3.5" />
          <span>Next scheduled buy</span>
        </div>
        <p className="mt-1 font-mono text-sm font-medium text-amber-glow">
          {getNextSunday()}
        </p>
        {asset && (
          <p className="mt-0.5 font-mono text-xs text-surface-400">
            ~R${parseFloat(asset.buyAmount).toFixed(0)} of {asset.pair}
          </p>
        )}
      </div>
    </div>
  );
}

function ServiceRow({
  icon,
  label,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
}) {
  const ok = status === "connected";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-surface-400">{icon}</span>
      <span className="text-surface-300">{label}</span>
      <span className="ml-auto flex items-center gap-1">
        {ok ? (
          <CircleCheck className="h-3.5 w-3.5 text-green-gain" />
        ) : (
          <CircleX className="h-3.5 w-3.5 text-red-loss" />
        )}
        <span
          className={`font-mono text-xs ${ok ? "text-green-gain" : "text-red-loss"}`}
        >
          {status}
        </span>
      </span>
    </div>
  );
}
