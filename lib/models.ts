/**
 * Model tiering — cheap by default, flag to upgrade.
 *
 * Every paid stage of the pipeline reads its model id (and quality knobs) from
 * here so that nothing is hardcoded in stage code. The tier is resolved from,
 * in order of precedence:
 *   1. an explicit argument (per-job / per-script `--tier`)
 *   2. the QUALITY_TIER env var
 *   3. the default: "draft"
 *
 * NOTE: the exact provider model ids below are best-effort and MUST be verified
 * against current Runway / Anthropic / ElevenLabs docs at integration time
 * (flagged in the plan). They are centralized here precisely so that's a
 * one-line change per stage.
 */

export type Tier = "draft" | "final";

/**
 * News-anchor voice settings ("Sarah – expressive"). Low stability gives the
 * varied tempo/intonation of a real broadcaster (high stability sounds
 * flat/robotic); high style adds the modulation/"wave"; speaker boost firms up
 * presence. Tuned via `npm run voicetest`.
 */
const ANCHOR_VOICE = {
  stability: 0.22,
  similarity_boost: 0.85,
  style: 0.6,
  use_speaker_boost: true,
};

export const TIERS: readonly Tier[] = ["draft", "final"] as const;

export function isTier(value: unknown): value is Tier {
  return value === "draft" || value === "final";
}

/** Resolve the active tier from an optional override, then env, then default. */
export function resolveTier(override?: string | null): Tier {
  if (isTier(override)) return override;
  const fromEnv = process.env.QUALITY_TIER;
  if (isTier(fromEnv)) return fromEnv;
  return "draft";
}

export interface StageModels {
  /** LLM used to deconstruct the article and write the storyboard. */
  llm: { model: string; maxTokens: number };
  /** Text-to-image (nano banana via Runway) for scene frames. */
  image: { model: string; ratio: string };
  /** Image-to-video (Runway Gen-4) for animating frames. */
  video: { model: string; ratio: string; maxSeconds: number };
  /**
   * Audio-driven talking-anchor lip-sync (Runway avatarVideos / gwm1_avatars).
   * `enabled: false` skips it (draft holds on the animated frame instead).
   */
  lipSync: {
    enabled: boolean;
    model: string;
    avatar: { type: "runway-preset"; presetId: string };
    ratio: string;
  };
  /**
   * Text-to-speech narration. `provider` selects Runway (billed on Runway
   * credits, fixed preset voices) or direct ElevenLabs (tuned voice + settings).
   */
  tts: {
    provider: "runway" | "elevenlabs";
    /** Runway preset voice id (when provider === "runway"). */
    runwayVoice: string;
    /** ElevenLabs model + voice + settings (when provider === "elevenlabs"). */
    model: string;
    voiceId: string;
    settings: {
      stability: number;
      similarity_boost: number;
      style: number;
      use_speaker_boost: boolean;
    };
  };
  /**
   * In draft, optionally skip the most expensive animation step and hold on a
   * still frame so the full pipeline still runs end-to-end for cents.
   */
  animate: { enabled: boolean };
}

const DRAFT: StageModels = {
  llm: { model: "claude-haiku-4-5-20251001", maxTokens: 4096 },
  image: { model: "gemini_2.5_flash", ratio: "1344:768" },
  video: { model: "gen4_turbo", ratio: "1280:720", maxSeconds: 10 },
  // Lip-sync skipped in draft (cheap iteration): anchor holds on the animated frame.
  lipSync: {
    enabled: false,
    model: "gwm1_avatars",
    avatar: { type: "runway-preset", presetId: "influencer" },
    ratio: "1280:720",
  },
  tts: {
    provider: "runway",
    runwayVoice: process.env.RUNWAY_TTS_VOICE ?? "Rachel",
    model: "eleven_multilingual_v2",
    voiceId: process.env.TTS_VOICE_ID ?? "",
    settings: ANCHOR_VOICE,
  },
  // Cost-saver: draft holds on still frames instead of paying for image-to-video.
  animate: { enabled: false },
};

const FINAL: StageModels = {
  llm: { model: "claude-opus-4-8", maxTokens: 8192 },
  image: { model: "gemini_image3_pro", ratio: "1344:768" },
  video: { model: "gen4.5", ratio: "1280:720", maxSeconds: 10 },
  lipSync: {
    enabled: true,
    model: "gwm1_avatars",
    avatar: { type: "runway-preset", presetId: "influencer" },
    ratio: "1280:720",
  },
  tts: {
    provider: "runway",
    runwayVoice: process.env.RUNWAY_TTS_VOICE ?? "Rachel",
    model: "eleven_multilingual_v2",
    voiceId: process.env.TTS_VOICE_ID ?? "",
    settings: ANCHOR_VOICE,
  },
  animate: { enabled: true },
};

const TABLE: Record<Tier, StageModels> = { draft: DRAFT, final: FINAL };

/** Return the model map for a tier (resolves the tier if a raw override is passed). */
export function models(tierOrOverride?: string | null): StageModels {
  return TABLE[resolveTier(tierOrOverride)];
}
