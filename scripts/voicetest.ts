/**
 * Voice comparison: `npm run voicetest`
 *
 * Synthesizes the same news-anchor line across candidate voices using the
 * high-quality model + low-stability "anchor" settings, into out/voicetest/.
 * Listen and pick the one you want; set its id as TTS_VOICE_ID in .env.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { synthesizeNarration } from "@/lib/tts";

const SAMPLE =
  "Good evening. Tonight, a new U-S Iran deal raises a difficult question: what was the war actually for? " +
  "We're live with the details, and what comes next.";

type SettingsOverride = Partial<{
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}>;

// Premade voices usable on the free plan (library voices require a paid plan).
const CANDIDATES: Array<{ label: string; voiceId: string; settings?: SettingsOverride }> = [
  { label: "Sarah-anchor", voiceId: "EXAVITQu4vr4xnSDxMaL" },
  { label: "Bella-anchor", voiceId: "hpp4J3VqNfWAUOO0d1Us" },
  { label: "Matilda-anchor", voiceId: "XrExE9yKIg1WjnnlVkGX" },
  // Higher-modulation variants of the top candidate (more "wave"):
  { label: "Sarah-expressive", voiceId: "EXAVITQu4vr4xnSDxMaL", settings: { stability: 0.22, style: 0.6 } },
  { label: "Bella-expressive", voiceId: "hpp4J3VqNfWAUOO0d1Us", settings: { stability: 0.22, style: 0.6 } },
];

// Use the highest-quality non-v3 model for the audition (supports timestamps).
const MODEL = "eleven_multilingual_v2";

async function main() {
  const dir = "out/voicetest";
  await mkdir(dir, { recursive: true });

  for (const c of CANDIDATES) {
    try {
      const { audio, durationSeconds } = await synthesizeNarration(SAMPLE, "final", {
        voiceId: c.voiceId,
        model: MODEL,
        settings: c.settings,
      });
      const path = join(dir, `${c.label}.mp3`);
      await writeFile(path, audio);
      console.log(`  ${c.label.padEnd(24)} ${durationSeconds.toFixed(1)}s  ${path}`);
    } catch (err) {
      console.log(`  ${c.label.padEnd(24)} FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`\nListen: open ${dir}`);
  console.log("Model:", MODEL, "· settings: stability 0.35 / style 0.45 (anchor modulation)");
}

main().catch((err) => {
  console.error("voicetest error:", err.message ?? err);
  process.exit(1);
});
