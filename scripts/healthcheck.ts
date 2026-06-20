/**
 * Step 0 healthcheck: verifies the toolchain and reports which integrations are
 * configured, without requiring any of them. Run: `npm run healthcheck`.
 */
import { execFileSync } from "node:child_process";
import { env } from "@/lib/env";
import { resolveTier, models } from "@/lib/models";
import { log } from "@/lib/log";

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

function ffmpegVersion(): string | null {
  try {
    const out = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" });
    return out.split("\n")[0];
  } catch {
    return null;
  }
}

log.info(`RNN healthcheck — node ${process.version}`);

const ff = ffmpegVersion();
check("ffmpeg", !!ff, ff ?? "NOT FOUND (needed for Step 7 stitching)");

const tier = resolveTier();
console.log(`\nActive quality tier: ${tier}`);
console.log("Resolved models:", JSON.stringify(models(tier), null, 2));

console.log("\nConfigured integrations:");
check("Supabase", !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY));
check("Runway", !!env.RUNWAY_API_KEY);
check("Anthropic", !!env.ANTHROPIC_API_KEY);
check("ElevenLabs", !!(env.ELEVENLABS_API_KEY && env.TTS_VOICE_ID));
check("Scraper fallback", !!env.SCRAPER_API_KEY, "optional");

console.log("\nhealthcheck complete (missing integrations are filled in per-step).");
