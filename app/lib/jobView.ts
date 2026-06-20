/** Client-side view model for jobs (mirrors lib/jobs.ts `JobView`). */

export interface JobView {
  id: string;
  sourceUrl: string;
  tier: string | null;
  status: "queued" | "extracting" | "scripting" | "generating" | "stitching" | "completed" | "failed";
  progress: number;
  headline: string | null;
  summary: string | null;
  keyPoints: string[];
  videoUrl: string | null;
  error: string | null;
  errorCode: string | null;
  createdAt: number;
}

/** A short, bold headline for a failure, derived from its category code. */
export function errorLabel(code: string | null): string {
  switch (code) {
    case "paywall":
      return "Paywalled / Blocked";
    case "not_found":
      return "Page Not Found";
    case "unreadable":
      return "Couldn’t Read Page";
    case "invalid_url":
      return "Invalid Link";
    case "network":
      return "Couldn’t Reach Page";
    default:
      return "Generation Failed";
  }
}

/** Material Symbols glyph for a failure category. */
export function errorIcon(code: string | null): string {
  switch (code) {
    case "paywall":
      return "lock";
    case "not_found":
      return "search_off";
    case "unreadable":
      return "article_shortcut";
    case "invalid_url":
      return "link_off";
    case "network":
      return "wifi_off";
    default:
      return "error";
  }
}

/** Bare hostname for display (falls back to the raw string). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "OCT 24, 2023" style date from an epoch-ms timestamp. */
export function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms)
    .toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
    .toUpperCase();
}
