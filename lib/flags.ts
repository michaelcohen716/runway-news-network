/**
 * Runtime feature flags safe to import from both server and client code
 * (no node-only dependencies). NEXT_PUBLIC_* values are inlined at build time.
 */

/**
 * Production "final-only" mode. When enabled, draft-tier generation is forced to
 * final, the quality toggle is hidden, and only final-tier segments are
 * watchable. Set NEXT_PUBLIC_RNN_FINAL_ONLY=true to turn it on.
 */
export const FINAL_ONLY = process.env.NEXT_PUBLIC_RNN_FINAL_ONLY === "true";
