const ELLIPSIS = "…";

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function trimZero(text: string): string {
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trimZero((n / 1e9).toFixed(1))}B`;
  if (abs >= 1e6) return `${trimZero((n / 1e6).toFixed(1))}M`;
  if (abs >= 1e3) return `${trimZero((n / 1e3).toFixed(1))}k`;
  return String(n);
}

export const truncate = (text: string, max = 12): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}${ELLIPSIS}`;
};

export function href(base: string, path: string[], query?: string): string {
  const parts = path.map((p) => encodeURIComponent(p)).join("/");
  if (query === undefined || query === "") return `${base}/${parts}`;
  return `${base}/${parts}?q=${encodeURIComponent(query)}`;
}

export function relativeTime(now: Date, then: Date): string {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "at an unknown time";
  if (seconds < 0) return "in the future";
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${pluralise(minutes, "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${pluralise(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  switch (days) {
    case 1:
      return "yesterday";
    case 7:
      return "a week ago";
    default:
      return `${days} ${pluralise(days, "day")} ago`;
  }
}
