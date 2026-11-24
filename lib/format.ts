const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS));
}

/** "today", "1 day", "12 days" — compact age of a task. */
export function formatAge(iso: string, now: Date = new Date()): string {
  const days = ageInDays(iso, now);
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
