/**
 * One-time builder for the canonical RNN anchor: `npm run build:anchor`
 *
 * Generates a fixed anchor portrait → brand/anchor.png. The pipeline passes this
 * as a reference image to every anchor scene so the same person appears across
 * the whole segment (and it can seed a custom lip-sync avatar later).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { generateFrame } from "@/lib/runway";

const ANCHOR_PROMPT =
  "Medium close-up of a professional female news anchor in her early 40s, " +
  "shoulder-length auburn hair, navy blazer, seated at a sleek modern news desk, " +
  "looking directly into the camera with a composed expression, dark blue studio " +
  "set with soft red accent lighting, shallow depth of field.";

async function main() {
  const tier = process.argv.includes("--tier")
    ? process.argv[process.argv.indexOf("--tier") + 1]
    : undefined;
  const { url, image } = await generateFrame(ANCHOR_PROMPT, { tier });
  await mkdir("brand", { recursive: true });
  await writeFile("brand/anchor.png", image);
  console.log(`wrote brand/anchor.png (${image.length} bytes)\nsource: ${url}`);
}

main().catch((err) => {
  console.error("build-anchor error:", err.message ?? err);
  process.exit(1);
});
