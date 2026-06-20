/**
 * Step 4 dev script: `npm run step:frame -- "<prompt>" [--tier draft|final]`
 * Generates a nano-banana keyframe and saves it to out/frame-<pid>.png.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { generateFrame } from "@/lib/runway";

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const prompt = args.find((a, i) => !a.startsWith("--") && i !== tierValueIdx);
  if (!prompt) {
    console.error('usage: npm run step:frame -- "<prompt>" [--tier draft|final]');
    process.exit(1);
  }

  const { url, image } = await generateFrame(prompt, { tier });
  await mkdir("out", { recursive: true });
  const path = `out/frame-${process.pid}.png`;
  await writeFile(path, image);
  console.log(`wrote ${path} (${image.length} bytes)\nsource: ${url}`);
}

main().catch((err) => {
  console.error("frame error:", err.message ?? err);
  process.exit(1);
});
