/**
 * Step 7 — Stitch + overlays (ffmpeg).
 *
 * Two-pass assembly:
 *   1. normalizeAndLabel(): re-encode each clip (opener + scenes) to a uniform
 *      codec / resolution / fps / audio layout, burning in the scene's chyron
 *      lower-third and the persistent "RNN" logo bug. Silent clips get a silent
 *      audio track so concat stays uniform.
 *   2. concatClips(): concat-demuxer copy of the now-uniform clips into one MP4.
 *
 * Keeping normalize and concat separate means the heavy per-clip filtering is
 * done once and the final join is a fast stream copy.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { log } from "@/lib/log";

const exec = promisify(execFile);

export interface VideoFormat {
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_FORMAT: VideoFormat = { width: 1280, height: 720, fps: 30 };

/** Escape text for inclusion in SVG/XML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the chyron lower-third + logo bug as a transparent PNG sized to the
 * frame, using sharp (SVG → PNG). This avoids depending on ffmpeg being built
 * with drawtext/libfreetype — we composite the PNG with the core `overlay`
 * filter instead, which works on any ffmpeg build.
 */
async function renderOverlayPng(
  out: string,
  fmt: VideoFormat,
  opts: { chyron?: string; logo?: string },
): Promise<void> {
  const { width: W, height: H } = fmt;
  const parts: string[] = [];

  if (opts.logo) {
    const t = escapeXml(opts.logo);
    parts.push(
      `<rect x="${W - 120}" y="24" width="96" height="44" rx="6" fill="#cc0000" fill-opacity="0.9"/>`,
      `<text x="${W - 72}" y="54" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="white" text-anchor="middle">${t}</text>`,
    );
  }

  if (opts.chyron) {
    const t = escapeXml(opts.chyron.toUpperCase());
    const barY = H - 120;
    parts.push(
      `<rect x="0" y="${barY}" width="${W}" height="64" fill="black" fill-opacity="0.72"/>`,
      `<rect x="0" y="${barY}" width="10" height="64" fill="#cc0000"/>`,
      `<text x="36" y="${barY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="white">${t}</text>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}

async function hasAudioStream(input: string): Promise<boolean> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      input,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

interface LabelOptions {
  chyron?: string;
  /** Logo bug text shown top-right on every clip. Default "RNN"; "" disables. */
  logo?: string;
  format?: VideoFormat;
}

export async function normalizeAndLabel(
  input: string,
  output: string,
  opts: LabelOptions = {},
): Promise<void> {
  const format = opts.format ?? DEFAULT_FORMAT;
  const logo = opts.logo === undefined ? "RNN" : opts.logo;
  const audio = await hasAudioStream(input);
  const needsOverlay = Boolean(logo || opts.chyron);

  const fit =
    `scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,` +
    `pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${format.fps}`;

  const args = ["-y", "-i", input];
  let overlayDir: string | undefined;
  let nextInput = 1; // next ffmpeg input index after the source (0)

  let overlayIdx: number | undefined;
  if (needsOverlay) {
    overlayDir = await mkdtemp(join(tmpdir(), "rnn-ovl-"));
    const png = join(overlayDir, "overlay.png");
    await renderOverlayPng(png, format, { chyron: opts.chyron, logo });
    args.push("-i", png);
    overlayIdx = nextInput++;
  }

  let silentIdx: number | undefined;
  if (!audio) {
    // Add a silent stereo track so every normalized clip has audio.
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    silentIdx = nextInput++;
  }

  // Filtergraph fits the video, then overlays the PNG if present, labelled [v].
  const filter =
    overlayIdx !== undefined
      ? `[0:v]${fit}[bg];[bg][${overlayIdx}:v]overlay=0:0,format=yuv420p[v]`
      : `[0:v]${fit},format=yuv420p[v]`;

  args.push(
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", audio ? "0:a:0" : `${silentIdx}:a:0`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(format.fps),
    "-c:a", "aac",
    "-ar", "44100",
    "-ac", "2",
    "-shortest",
    output,
  );

  try {
    await exec("ffmpeg", args);
  } finally {
    if (overlayDir) await rm(overlayDir, { recursive: true, force: true });
  }
}

/**
 * Build a silent clip of `seconds` by holding on a still image (ffmpeg, no API).
 * Used by the draft cost-saver: skip paid image-to-video and hold on the frame.
 */
export async function stillToClip(
  imagePath: string,
  seconds: number,
  output: string,
  format: VideoFormat = DEFAULT_FORMAT,
): Promise<void> {
  const { width: W, height: H, fps } = format;
  await exec("ffmpeg", [
    "-y",
    "-loop", "1", "-i", imagePath,
    "-t", String(seconds),
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`,
    "-r", String(fps),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-an",
    output,
  ]);
}

/**
 * Mux a narration track onto a (typically silent) video clip. The video length
 * is preserved; narration is padded with trailing silence to fill it, so the
 * clip never gets cut short. Used for B-roll / non-lip-synced anchor scenes.
 */
export async function muxNarration(
  videoPath: string,
  audioPath: string,
  output: string,
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-af", "apad", // pad audio with silence...
    "-shortest", // ...then trim to the (finite) video length
    output,
  ]);
}

/** Concatenate already-normalized clips (uniform codec params) via stream copy. */
export async function concatClips(clips: string[], output: string): Promise<void> {
  if (clips.length === 0) throw new Error("concatClips: no clips");
  const dir = await mkdtemp(join(tmpdir(), "rnn-concat-"));
  const listPath = join(dir, "list.txt");
  const list = clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, list);
  try {
    await exec("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface SegmentScene {
  clipPath: string;
  chyron?: string;
}

/** Full assembly: normalize opener + scenes (with chyrons), then concat. */
export async function buildSegment(opts: {
  openerPath: string;
  scenes: SegmentScene[];
  outputPath: string;
  format?: VideoFormat;
  workDir: string;
}): Promise<string> {
  const format = opts.format ?? DEFAULT_FORMAT;
  const normalized: string[] = [];

  log.info("normalizing opener");
  const openerNorm = join(opts.workDir, "norm-opener.mp4");
  await normalizeAndLabel(opts.openerPath, openerNorm, { format, logo: "" }); // opener already branded
  normalized.push(openerNorm);

  for (let i = 0; i < opts.scenes.length; i++) {
    const scene = opts.scenes[i];
    const out = join(opts.workDir, `norm-scene-${i}.mp4`);
    log.info(`normalizing scene ${i}${scene.chyron ? ` ("${scene.chyron}")` : ""}`);
    await normalizeAndLabel(scene.clipPath, out, { format, chyron: scene.chyron });
    normalized.push(out);
  }

  log.info(`concatenating ${normalized.length} clips → ${opts.outputPath}`);
  await concatClips(normalized, opts.outputPath);
  return opts.outputPath;
}
