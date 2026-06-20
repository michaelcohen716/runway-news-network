/**
 * Step 7 dev script: `npm run step:stitch -- [clipA clipB ...]`
 *
 * With no args, synthesizes deliberately non-uniform test clips (different
 * sizes, each with a tone) plus a branded opener, then runs the full
 * buildSegment() path and prints the final MP4's duration. With clip paths,
 * uses those as the scenes instead.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildSegment } from "@/lib/compose";

const exec = promisify(execFile);

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  return Number(stdout.trim());
}

/** Synthesize a clip: colored test pattern + sine tone, given size/duration. */
async function synthClip(
  path: string,
  { size, seconds, freq }: { size: string; seconds: number; freq: number },
) {
  await exec("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-t", String(seconds),
    path,
  ]);
}

async function main() {
  const clipArgs = process.argv.slice(2);
  await mkdir("out", { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "rnn-stitch-"));

  try {
    // Branded opener (in the real pipeline this is brand/opener.mp4).
    const opener = join(work, "opener.mp4");
    await synthClip(opener, { size: "1280x720", seconds: 5, freq: 440 });

    let scenes;
    if (clipArgs.length) {
      scenes = clipArgs.map((clipPath, i) => ({
        clipPath,
        chyron: `Scene ${i + 1}`,
      }));
    } else {
      // Non-uniform test scenes to exercise normalization.
      const a = join(work, "a.mp4");
      const b = join(work, "b.mp4");
      const c = join(work, "c.mp4");
      await synthClip(a, { size: "640x360", seconds: 5, freq: 300 });
      await synthClip(b, { size: "960x540", seconds: 6, freq: 500 });
      await synthClip(c, { size: "1280x720", seconds: 4, freq: 700 });
      scenes = [
        { clipPath: a, chyron: "Breaking: test pattern alpha" },
        { clipPath: b, chyron: "Markets react to bars" },
        { clipPath: c, chyron: "Zelensky: end the noise" },
      ];
    }

    const outputPath = "out/segment.mp4";
    await buildSegment({ openerPath: opener, scenes, outputPath, workDir: work });

    const dur = await probeDuration(outputPath);
    console.log(
      `\nwrote ${outputPath} — ${dur.toFixed(2)}s (opener 5s + ${scenes.length} scenes)`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("stitch error:", err.message ?? err);
  process.exit(1);
});
