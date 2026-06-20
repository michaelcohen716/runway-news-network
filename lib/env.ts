/**
 * Central environment loader. Imported once at the top of every entrypoint
 * (worker, dev scripts). Loads .env via dotenv and exposes typed accessors.
 *
 * Keys are intentionally NOT required at import time — each stage validates the
 * specific keys it needs via `requireEnv(...)`, so scaffold/healthcheck and
 * stages that don't touch a given service can run without every secret present.
 */
import "dotenv/config";

export const env = {
  QUALITY_TIER: process.env.QUALITY_TIER,

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,

  // External APIs
  RUNWAY_API_KEY: process.env.RUNWAY_API_KEY,
  // Optional pre-built Runway custom avatar id for the anchor (skips creation)
  RUNWAY_ANCHOR_AVATAR_ID: process.env.RUNWAY_ANCHOR_AVATAR_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  TTS_VOICE_ID: process.env.TTS_VOICE_ID,

  // Optional scraper fallback for paywalled / JS-heavy articles
  SCRAPER_API_KEY: process.env.SCRAPER_API_KEY,
  // Optional Jina Reader key (works keyless too, just with lower rate limits)
  JINA_API_KEY: process.env.JINA_API_KEY,
  // Access password required to generate final-tier videos (prod gate). When
  // unset, final generation is ungated (local dev).
  RNN_FINAL_PASSWORD: process.env.RNN_FINAL_PASSWORD,

  // Worker tuning
  WORKER_POLL_MS: Number(process.env.WORKER_POLL_MS ?? 3000),
} as const;

/** Assert that the given env keys are present; throw a clear error otherwise. */
export function requireEnv<K extends keyof typeof env>(...keys: K[]): {
  [P in K]: string;
} {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Add them to .env (see .env.example).`,
    );
  }
  return Object.fromEntries(keys.map((k) => [k, env[k]])) as unknown as {
    [P in K]: string;
  };
}
