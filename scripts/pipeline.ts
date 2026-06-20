/**
 * Step 8 dev script: `npm run pipeline -- <url> [--tier draft|final]`
 * Runs the full pipeline and writes the finished segment to out/segment-<pid>.mp4.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runPipeline } from "@/lib/pipeline";

const exec = promisify(execFile);

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const url = args.find((a, i) => !a.startsWith("--") && i !== tierValueIdx);
  if (!url) {
    console.error("usage: npm run pipeline -- <url> [--tier draft|final]");
    process.exit(1);
  }

  await mkdir("out", { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "rnn-pipeline-"));
  const outputPath = `out/segment-${process.pid}.mp4`;
  const started = Date.now();
  try {
    const result = await runPipeline(url, { tier, workDir: work, outputPath });
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", outputPath,
    ]);
    console.log(`\nHeadline: ${result.storyboard.headline}`);
    console.log(`Wrote ${outputPath} — ${Number(stdout.trim()).toFixed(1)}s total`);
    console.log(`(${result.storyboard.scenes.length} scenes, ${result.contentSeconds.toFixed(1)}s content)`);
    console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("pipeline error:", err.message ?? err);
  process.exit(1);
});
