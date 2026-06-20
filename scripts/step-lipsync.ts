/**
 * Step 6 dev script: `npm run step:lipsync -- <audio.mp3> [--tier ...]`
 * Produces a lip-synced talking-anchor clip from narration audio.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { lipSyncAnchor } from "@/lib/runway";

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const audioPath = args.find((a, i) => !a.startsWith("--") && i !== tierValueIdx);
  if (!audioPath) {
    console.error("usage: npm run step:lipsync -- <audio.mp3> [--tier draft|final]");
    process.exit(1);
  }

  const audio = await readFile(audioPath);
  const { url, video } = await lipSyncAnchor(audio, { tier });
  await mkdir("out", { recursive: true });
  const path = `out/lipsync-${process.pid}.mp4`;
  await writeFile(path, video);
  console.log(`wrote ${path} (${video.length} bytes)\nsource: ${url}`);
}

main().catch((err) => {
  console.error("lipsync error:", err.message ?? err);
  process.exit(1);
});
