/**
 * One-time builder for the branded RNN opener: `npm run build:opener`
 *
 * Produces brand/opener.mp4 — a ~2s animated "RUNWAY NEWS NETWORK" title with a
 * broadcast sting. The animation is rendered frame-by-frame as SVG via sharp
 * (no ffmpeg drawtext dependency), then encoded with the sting audio.
 *
 * Audio: tries the ElevenLabs sound-generation API for a real news sting; if
 * that's unavailable (e.g. plan limits), falls back to an ffmpeg-synthesized
 * stinger (impact boom + rising whoosh + bright hit).
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

const exec = promisify(execFile);

const W = 1280;
const H = 720;
const FPS = 30;
const DURATION = 2.0;
const FRAMES = Math.round(DURATION * FPS);

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t);
/** Bell curve peaking at center of [s,e]. */
const bell = (p: number, s: number, e: number) => {
  if (p < s || p > e) return 0;
  return Math.sin((Math.PI * (p - s)) / (e - s));
};

/** SVG for the opener at normalized progress p ∈ [0,1]. */
function frameSvg(p: number): string {
  const cx = W / 2;
  const cy = H / 2;

  // Red accent bars wipe in from the edges.
  const barW = easeOut(p / 0.28) * W;

  // Badge ("RNN") scales + fades in.
  const badge = easeOut((p - 0.12) / 0.33);
  const badgeScale = lerp(0.7, 1, badge);
  const badgeOpacity = clamp(badge * 1.2);

  // Wordmark fades in with expanding letter-spacing.
  const word = easeOut((p - 0.32) / 0.3);
  const wordOpacity = clamp(word * 1.2);
  const wordSpacing = lerp(2, 10, word);

  // Diagonal shine sweeping across the badge.
  const shineP = (p - 0.45) / 0.35;
  const shineX = lerp(-0.35, 1.35, shineP) * W;
  const shineOpacity = shineP > 0 && shineP < 1 ? 0.55 : 0;

  // White impact flash on badge landing.
  const flash = bell(p, 0.12, 0.26) * 0.7;

  // Title "flashes" near the end (opacity pulse), matching the brief.
  const flicker =
    p > 0.7 ? 0.55 + 0.45 * Math.abs(Math.sin((p - 0.7) * Math.PI * 4)) : 1;

  const badgeW = 220;
  const badgeH = 150;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c1f4a"/>
      <stop offset="1" stop-color="#040a1c"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>

  <!-- accent bars -->
  <rect x="0" y="${cy - 200}" width="${barW}" height="6" fill="#e10600"/>
  <rect x="${W - barW}" y="${cy + 194}" width="${barW}" height="6" fill="#e10600"/>

  <!-- badge -->
  <g transform="translate(${cx} ${cy - 40}) scale(${badgeScale.toFixed(3)})" opacity="${badgeOpacity.toFixed(3)}">
    <rect x="${-badgeW / 2}" y="${-badgeH / 2}" width="${badgeW}" height="${badgeH}" rx="14" fill="#e10600"/>
    <text x="0" y="34" font-family="Arial, Helvetica, sans-serif" font-size="120" font-weight="800"
          fill="white" text-anchor="middle">RNN</text>
  </g>

  <!-- shine over badge -->
  ${
    shineOpacity > 0
      ? `<rect x="${shineX - 60}" y="${cy - 130}" width="120" height="220" fill="url(#shine)" opacity="${shineOpacity}" transform="skewX(-18)"/>`
      : ""
  }

  <!-- wordmark -->
  <g opacity="${(wordOpacity * flicker).toFixed(3)}">
    <text x="${cx}" y="${cy + 150}" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700"
          fill="white" text-anchor="middle" letter-spacing="${wordSpacing.toFixed(1)}">RUNWAY NEWS NETWORK</text>
  </g>

  <!-- impact flash -->
  ${flash > 0 ? `<rect width="${W}" height="${H}" fill="#ffffff" opacity="${flash.toFixed(3)}"/>` : ""}
</svg>`;
}

/** Generate the sting audio; returns its path. Tries ElevenLabs, then ffmpeg. */
async function makeAudio(dir: string): Promise<string> {
  const out = join(dir, "sting.mp3");

  if (env.ELEVENLABS_API_KEY) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Dramatic cable news broadcast intro sting: deep brass and synth impact hit with a rising whoosh, breaking-news bumper, clean ending.",
          duration_seconds: DURATION,
          prompt_influence: 0.6,
        }),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(out, buf);
        log.info("sting: ElevenLabs sound-generation");
        return out;
      }
      log.warn(`ElevenLabs sound-gen HTTP ${res.status}; using ffmpeg fallback`);
    } catch (err) {
      log.warn(`ElevenLabs sound-gen failed (${(err as Error).message}); ffmpeg fallback`);
    }
  }

  // ffmpeg synth fallback: impact boom + rising whoosh + bright hit, mixed.
  log.info("sting: ffmpeg-synthesized fallback");
  const boom = "sine=frequency=70:duration=2,volume=1.2,afade=t=out:st=0.4:d=1.6";
  const whoosh =
    "anoisesrc=d=1.1:c=pink:a=0.25,highpass=f=300,afade=t=in:st=0:d=0.9,afade=t=out:st=0.9:d=0.2";
  const hit = "sine=frequency=880:duration=0.5,volume=0.5,adelay=300|300,afade=t=out:st=0.2:d=0.3";
  await exec("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", boom,
    "-f", "lavfi", "-i", whoosh,
    "-f", "lavfi", "-i", hit,
    "-filter_complex", "[0][1][2]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95,aformat=sample_rates=44100:channel_layouts=stereo[a]",
    "-map", "[a]", "-t", String(DURATION),
    out,
  ]);
  return out;
}

async function main() {
  await mkdir("brand", { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "rnn-opener-"));
  try {
    log.info(`rendering ${FRAMES} frames`);
    for (let i = 0; i < FRAMES; i++) {
      const p = i / (FRAMES - 1);
      const png = join(work, `frame-${String(i).padStart(3, "0")}.png`);
      await sharp(Buffer.from(frameSvg(p))).png().toFile(png);
    }

    const audio = await makeAudio(work);
    const out = "brand/opener.mp4";
    log.info("encoding opener.mp4");
    await exec("ffmpeg", [
      "-y",
      "-framerate", String(FPS),
      "-i", join(work, "frame-%03d.png"),
      "-i", audio,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-t", String(DURATION), "-shortest",
      out,
    ]);
    console.log(`\nwrote ${out} (${DURATION}s, ${W}x${H}@${FPS})`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("build-opener error:", err.message ?? err);
  process.exit(1);
});
