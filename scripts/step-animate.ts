/**
 * Step 5 dev script: `npm run step:animate -- <image.png> <seconds> [--tier ...]`
 * Animates a still frame into a clip and saves out/clip-<pid>.mp4.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { animateImage } from "@/lib/runway";

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith("--") && i !== tierValueIdx);
  const [imagePath, secondsArg] = positional;
  if (!imagePath || !secondsArg) {
    console.error("usage: npm run step:animate -- <image.png> <seconds> [--tier draft|final]");
    process.exit(1);
  }

  const image = await readFile(imagePath);
  const { url, video } = await animateImage(image, Number(secondsArg), { tier });
  await mkdir("out", { recursive: true });
  const path = `out/clip-${process.pid}.mp4`;
  await writeFile(path, video);
  console.log(`wrote ${path} (${video.length} bytes)\nsource: ${url}`);
}

main().catch((err) => {
  console.error("animate error:", err.message ?? err);
  process.exit(1);
});
