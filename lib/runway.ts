/**
 * Runway API wrappers (Steps 4–6).
 *
 * Each Runway generation is an async task: create → poll → download. The SDK's
 * `.waitForTaskOutput()` handles the polling and returns `{ output: string[] }`
 * of result URLs, which we fetch into Buffers.
 *
 * Verified model IDs (SDK v4):
 *   - text-to-image:  gemini_2.5_flash (draft) / gemini_image3_pro (final)  [nano banana]
 *   - image-to-video: gen4_turbo (draft) / gen4.5 (final)
 *   - lip-sync:       avatarVideos / gwm1_avatars  (audio-driven talking head)
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import RunwayML, { toFile } from "@runwayml/sdk";
import { env, requireEnv } from "@/lib/env";
import { models } from "@/lib/models";
import { log } from "@/lib/log";

let _client: RunwayML | null = null;
function client(): RunwayML {
  if (!_client) {
    const { RUNWAY_API_KEY } = requireEnv("RUNWAY_API_KEY");
    _client = new RunwayML({ apiKey: RUNWAY_API_KEY });
  }
  return _client;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function dataUri(image: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${image.toString("base64")}`;
}

export interface SpeechResult {
  url: string;
  audio: Buffer;
}

/**
 * Runway TTS (ElevenLabs Multilingual v2, billed on Runway credits). Fixed
 * preset voices, no stability/style control. Duration is measured downstream
 * via ffprobe (no timestamp endpoint).
 */
export async function generateSpeech(
  text: string,
  opts: { tier?: string | null } = {},
): Promise<SpeechResult> {
  const m = models(opts.tier);
  log.info(`runway tts: ${m.tts.runwayVoice} (${text.length} chars)`);
  const task = await client()
    .textToSpeech.create({
      model: "eleven_multilingual_v2",
      promptText: text,
      voice: { type: "runway-preset", presetId: m.tts.runwayVoice as "Rachel" },
    })
    .waitForTaskOutput();
  const url = task.output[0];
  return { url, audio: await download(url) };
}

export interface FrameResult {
  url: string;
  image: Buffer;
}

/**
 * Appended to every image prompt to keep frames clean (we overlay our own
 * chyron/logo) and photorealistic. nano banana tends to invent on-screen news
 * graphics otherwise.
 */
const FRAME_STYLE_SUFFIX =
  " Photorealistic broadcast news footage, cinematic lighting, shot on a professional camera. " +
  "Absolutely no text, captions, subtitles, lower-thirds, news tickers, logos, or watermarks anywhere in the image.";

/**
 * Step 4 — Generate a scene keyframe with nano banana (Gemini via Runway).
 * Optional reference images (e.g. a fixed anchor portrait) keep a character
 * consistent across scenes.
 */
export async function generateFrame(
  prompt: string,
  opts: { tier?: string | null; referenceImages?: Buffer[] } = {},
): Promise<FrameResult> {
  const m = models(opts.tier);
  const refs = (opts.referenceImages ?? []).map((b, i) => ({
    uri: dataUri(b),
    tag: `ref${i}`,
  }));

  log.info(`frame: ${m.image.model} ${m.image.ratio}${refs.length ? ` (+${refs.length} ref)` : ""}`);
  const task = await client()
    .textToImage.create({
      // model union is validated by the SDK; cast since model id comes from config.
      model: m.image.model as "gemini_2.5_flash",
      promptText: prompt + FRAME_STYLE_SUFFIX,
      ratio: m.image.ratio as "1344:768",
      ...(refs.length ? { referenceImages: refs } : {}),
    })
    .waitForTaskOutput();

  const url = task.output[0];
  return { url, image: await download(url) };
}

export interface ClipResult {
  url: string;
  video: Buffer;
}

/**
 * Motion directive for image-to-video. Keeps the existing frame's content and
 * just adds gentle, broadcast-appropriate movement (the model requires a
 * non-empty promptText for gen4.5).
 */
const MOTION_SUFFIX =
  "Subtle, natural cinematic motion: slow camera push-in with gentle parallax. " +
  "Keep the composition and subject unchanged. Broadcast news footage. No added text or graphics.";

/**
 * Step 5 — Animate a keyframe into a clip with image-to-video (Runway Gen-4).
 * Duration is clamped to [2, model max] seconds. `prompt` guides the motion;
 * promptText is required by the API, so we always send at least the suffix.
 */
export async function animateImage(
  image: Buffer,
  seconds: number,
  opts: { tier?: string | null; prompt?: string } = {},
): Promise<ClipResult> {
  const m = models(opts.tier);
  const duration = Math.max(2, Math.min(m.video.maxSeconds, Math.round(seconds)));
  const promptText = opts.prompt?.trim()
    ? `${opts.prompt.trim()}. ${MOTION_SUFFIX}`
    : MOTION_SUFFIX;

  log.info(`animate: ${m.video.model} ${m.video.ratio} ${duration}s`);
  const task = await client()
    .imageToVideo.create({
      model: m.video.model as "gen4_turbo",
      promptImage: dataUri(image),
      promptText,
      ratio: m.video.ratio as "1280:720",
      duration,
    })
    .waitForTaskOutput();

  const url = task.output[0];
  return { url, video: await download(url) };
}

/**
 * Where the created custom-anchor avatar id is cached between runs, keyed by a
 * hash of brand/anchor.png so it regenerates if the anchor image changes.
 */
const ANCHOR_AVATAR_CACHE = "brand/.anchor-avatar.json";
let _anchorAvatarPromise: Promise<string> | null = null;

/**
 * Resolve (creating + caching once) a Runway custom avatar built from the brand
 * anchor image, so the lip-synced talking head is *our* anchor — not a preset.
 *
 * Precedence: RUNWAY_ANCHOR_AVATAR_ID env → on-disk cache (matching image hash)
 * → create a new avatar (upload image, poll until READY) and cache it. Memoized
 * per-process so parallel anchor scenes don't each create a duplicate.
 */
async function anchorAvatarId(image: Buffer): Promise<string> {
  if (env.RUNWAY_ANCHOR_AVATAR_ID) return env.RUNWAY_ANCHOR_AVATAR_ID;
  if (_anchorAvatarPromise) return _anchorAvatarPromise;

  _anchorAvatarPromise = (async () => {
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);

    if (existsSync(ANCHOR_AVATAR_CACHE)) {
      try {
        const cached = JSON.parse(await readFile(ANCHOR_AVATAR_CACHE, "utf8"));
        if (cached.hash === hash && cached.id) {
          log.info(`lipsync: reusing cached anchor avatar ${cached.id}`);
          return cached.id as string;
        }
      } catch {
        /* corrupt cache — recreate below */
      }
    }

    // referenceImage must be an HTTPS URL — host the image via an ephemeral upload.
    const upload = await client().uploads.createEphemeral({
      file: await toFile(image, "anchor.png", { type: "image/png" }),
    });

    log.info("lipsync: creating custom anchor avatar from brand/anchor.png");
    const created = await client().avatars.create({
      name: "RNN Anchor",
      personality: "A professional, composed network news anchor.",
      referenceImage: upload.uri,
      imageProcessing: "optimize",
      // Required at creation, but unused: we drive the mouth with our own audio.
      voice: { type: "runway-live-preset", presetId: "victoria" },
    });

    // Avatar creation is async — poll until READY.
    let avatar: { id: string; status: "PROCESSING" | "READY" | "FAILED" } = created;
    const deadline = Date.now() + 180_000;
    while (avatar.status === "PROCESSING") {
      if (Date.now() > deadline) throw new Error("anchor avatar creation timed out");
      await new Promise((r) => setTimeout(r, 3000));
      avatar = await client().avatars.retrieve(created.id);
    }
    if (avatar.status !== "READY") {
      throw new Error(`anchor avatar creation ${avatar.status}`);
    }

    await writeFile(ANCHOR_AVATAR_CACHE, JSON.stringify({ id: avatar.id, hash }, null, 2));
    log.info(`lipsync: anchor avatar ready ${avatar.id}`);
    return avatar.id;
  })();

  // On failure, clear the memo so a later job can retry.
  _anchorAvatarPromise.catch(() => {
    _anchorAvatarPromise = null;
  });
  return _anchorAvatarPromise;
}

/**
 * Create (or reuse) the custom anchor avatar from a local image. Useful as a
 * one-time warm-up step so the first final-tier job doesn't pay creation latency.
 */
export async function ensureAnchorAvatar(path = "brand/anchor.png"): Promise<string> {
  return anchorAvatarId(await readFile(path));
}

/**
 * Step 6 — Lip-synced talking anchor from narration audio (Runway avatarVideos /
 * gwm1_avatars). When an `anchorImage` is given we drive a *custom avatar built
 * from it* (the brand anchor); otherwise we fall back to the configured preset
 * persona. Used for anchor scenes in the final tier; draft skips this.
 */
export async function lipSyncAnchor(
  audio: Buffer,
  opts: { tier?: string | null; anchorImage?: Buffer } = {},
): Promise<ClipResult> {
  const m = models(opts.tier);

  // Host the audio so Runway can fetch it.
  const upload = await client().uploads.createEphemeral({
    file: await toFile(audio, "narration.mp3", { type: "audio/mpeg" }),
  });

  const avatar = opts.anchorImage
    ? ({ type: "custom", avatarId: await anchorAvatarId(opts.anchorImage) } as const)
    : (m.lipSync.avatar as { type: "runway-preset"; presetId: "influencer" });

  log.info(
    `lipsync: ${m.lipSync.model} ${avatar.type === "custom" ? `custom=${avatar.avatarId}` : `preset=${avatar.presetId}`}`,
  );
  const task = await client()
    .avatarVideos.create({
      model: m.lipSync.model as "gwm1_avatars",
      avatar,
      speech: { type: "audio", audio: upload.uri },
    })
    .waitForTaskOutput();

  const url = task.output[0];
  return { url, video: await download(url) };
}
