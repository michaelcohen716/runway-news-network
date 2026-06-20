/**
 * Step 2 dev script: `npm run step:script -- <url> [--tier draft|final]`
 * Chains extraction (Step 1) → storyboard generation (Step 2) and prints it.
 */
import { extractArticle } from "@/lib/extract";
import { generateStoryboard } from "@/lib/llm";

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const url = args.find((a, i) => !a.startsWith("--") && i !== tierValueIdx);

  if (!url) {
    console.error("usage: npm run step:script -- <url> [--tier draft|final]");
    process.exit(1);
  }

  const article = await extractArticle(url);
  const storyboard = await generateStoryboard(article, tier);

  const total = storyboard.scenes.reduce((s, x) => s + x.targetSeconds, 0);
  console.log(JSON.stringify(storyboard, null, 2));
  console.log(
    `\n${storyboard.scenes.length} scenes, total ${total}s (+ ~5s opener)`,
  );
}

main().catch((err) => {
  console.error("script error:", err.message);
  process.exit(1);
});
