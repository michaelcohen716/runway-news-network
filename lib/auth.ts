/**
 * Final-tier access gate (server-only).
 *
 * The password lives solely in the RNN_FINAL_PASSWORD env var — it never reaches
 * the client. The browser POSTs a candidate password to /api/auth; on a match we
 * set an httpOnly cookie holding a one-way HMAC "proof" (not the password). Every
 * final-tier job request re-verifies that proof server-side. All comparisons are
 * timing-safe.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const FINAL_COOKIE = "rnn_final";

/** Whether a final-tier password is configured (gate active). */
export function finalPasswordConfigured(): boolean {
  return !!process.env.RNN_FINAL_PASSWORD;
}

/** Constant-time string compare that doesn't leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still run a compare to keep timing roughly constant.
    timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** True if the submitted password matches the configured one. */
export function checkPassword(input: string): boolean {
  const pw = process.env.RNN_FINAL_PASSWORD;
  if (!pw) return false;
  return safeEqual(input, pw);
}

/** The cookie proof derived from the password (one-way, not reversible). */
export function accessToken(): string {
  const pw = process.env.RNN_FINAL_PASSWORD ?? "";
  return createHmac("sha256", pw).update("rnn-final-access").digest("hex");
}

/** Validate a cookie proof against the configured password. */
export function checkToken(token: string | undefined | null): boolean {
  if (!token || !finalPasswordConfigured()) return false;
  return safeEqual(token, accessToken());
}
