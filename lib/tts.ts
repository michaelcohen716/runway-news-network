/**
 * Step 3 — Text-to-speech narration (ElevenLabs).
 *
 * Produces the spoken narration that is the pipeline's timing spine: each
 * scene's audio duration determines how long its video clip must be.
 *
 * We call the `/with-timestamps` endpoint so the response includes per-character
 * alignment — the last character end-time gives us a precise clip duration
 * without needing ffprobe locally. Returns the audio bytes + duration.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { requireEnv } from "@/lib/env";
import { models } from "@/lib/models";
import { generateSpeech } from "@/lib/runway";
import { log } from "@/lib/log";

const exec = promisify(execFile);

/** Measure an audio buffer's duration in seconds via ffprobe. */
async function probeDuration(audio: Buffer): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "rnn-probe-"));
  const path = join(dir, "a.mp3");
  try {
    await writeFile(path, audio);
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", path,
    ]);
    return Number(stdout.trim()) || 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface Narration {
  audio: Buffer;
  /** Precise spoken duration in seconds (from character alignment). */
  durationSeconds: number;
  contentType: string;
}

interface TimestampResponse {
  audio_base64: string;
  alignment?: { character_end_times_seconds?: number[] };
  normalized_alignment?: { character_end_times_seconds?: number[] };
}

const OUTPUT_FORMAT = "mp3_44100_128";

export interface TtsOverrides {
  /** Override the tier's default voice (used by the voice-test script). */
  voiceId?: string;
  /** Override the tier's default model. */
  model?: string;
  /** Override the tier's default voice settings. */
  settings?: Partial<{
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  }>;
}

export async function synthesizeNarration(
  text: string,
  tierOverride?: string | null,
  overrides: TtsOverrides = {},
): Promise<Narration> {
  const m = models(tierOverride);

  // Runway-backed TTS: bypasses the ElevenLabs quota, billed on Runway credits.
  // No timestamp endpoint, so duration is measured with ffprobe.
  if (m.tts.provider === "runway" && !overrides.voiceId) {
    const { audio } = await generateSpeech(text, { tier: tierOverride });
    return { audio, durationSeconds: await probeDuration(audio), contentType: "audio/mpeg" };
  }

  const { ELEVENLABS_API_KEY } = requireEnv("ELEVENLABS_API_KEY");
  const voiceId = overrides.voiceId ?? m.tts.voiceId;
  if (!voiceId) throw new Error("no TTS voice id (set TTS_VOICE_ID or pass voiceId)");
  const model_id = overrides.model ?? m.tts.model;
  const voice_settings = { ...m.tts.settings, ...overrides.settings };

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
  log.info(`synthesizing narration with ${model_id} (${text.length} chars)`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model_id, voice_settings }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} ${detail}`);
  }

  const data = (await res.json()) as TimestampResponse;
  if (!data.audio_base64) throw new Error("ElevenLabs returned no audio");

  const ends =
    data.alignment?.character_end_times_seconds ??
    data.normalized_alignment?.character_end_times_seconds ??
    [];
  const durationSeconds = ends.length ? ends[ends.length - 1] : 0;

  return {
    audio: Buffer.from(data.audio_base64, "base64"),
    durationSeconds,
    contentType: "audio/mpeg",
  };
}
