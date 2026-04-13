/**
 * "Next Sunday at 08:00 UTC" label used by empty states across the dashboard.
 * Mirrors the logic in StatusCard's `getNextSunday` — kept here so empty
 * states can hint at the next buy without duplicating the calculation in
 * every component. The cron is hardcoded to Sunday 08:00 UTC because that's
 * the only schedule currently shipped; if cronSchedule becomes configurable
 * per-asset, parse `PublicStatus.cronSchedule` here instead.
 */
export function nextSundayLabel(): string {
  const now = new Date();
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilSunday);
  next.setUTCHours(8, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return (
    next.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
