/**
 * Step 3 dev script: `npm run step:tts -- "<text>" [--tier draft|final]`
 * Writes the narration to ./out/tts-<ts>.mp3 and prints its duration.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { synthesizeNarration } from "@/lib/tts";

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const text = args.find((a, i) => !a.startsWith("--") && i !== tierValueIdx);

  if (!text) {
    console.error('usage: npm run step:tts -- "<text>" [--tier draft|final]');
    process.exit(1);
  }

  const { audio, durationSeconds, contentType } = await synthesizeNarration(
    text,
    tier,
  );

  await mkdir("out", { recursive: true });
  const path = `out/tts-${process.pid}.mp3`;
  await writeFile(path, audio);

  console.log(
    `wrote ${path} (${audio.length} bytes, ${contentType}) — ${durationSeconds.toFixed(2)}s`,
  );
}

main().catch((err) => {
  console.error("tts error:", err.message);
  process.exit(1);
});
