/**
 * Inspectable bundle for steps 1–3: `npm run preview -- <url> [--tier ...]`
 *
 * Runs extract → storyboard → duration-fit → per-scene TTS and writes
 * everything into out/preview-<pid>/ so you can open the article JSON, the
 * storyboard JSON, and listen to each scene's narration. The fit loop targets
 * the configured segment length. Precursor to the full pipeline (Step 8).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractArticle } from "@/lib/extract";
import { fitStoryboard } from "@/lib/fit";
import { OPENER_SECONDS, CONTENT_SECONDS, SEGMENT_SECONDS } from "@/lib/timing";

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

async function main() {
  const args = process.argv.slice(2);
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx >= 0 ? args[tierIdx + 1] : undefined;
  const tierValueIdx = tierIdx >= 0 ? tierIdx + 1 : -1;
  const url = args.find((a, i) => !a.startsWith("--") && i !== tierValueIdx);
  if (!url) {
    console.error("usage: npm run preview -- <url> [--tier draft|final]");
    process.exit(1);
  }

  const dir = join("out", `preview-${process.pid}`);
  await mkdir(dir, { recursive: true });

  const article = await extractArticle(url);
  await writeFile(join(dir, "article.json"), JSON.stringify(article, null, 2));

  const fit = await fitStoryboard(article, { tier, targetSeconds: CONTENT_SECONDS });
  await writeFile(join(dir, "storyboard.json"), JSON.stringify(fit.storyboard, null, 2));

  const manifest: Array<Record<string, unknown>> = [];
  for (const f of fit.scenes) {
    const file = `scene-${String(f.scene.index).padStart(2, "0")}.mp3`;
    await writeFile(join(dir, file), f.audio);
    manifest.push({
      index: f.scene.index,
      kind: f.scene.kind,
      chyron: f.scene.chyron,
      clipSeconds: f.scene.targetSeconds,
      words: countWords(f.scene.narration),
      actualSeconds: Number(f.durationSeconds.toFixed(2)),
      file,
    });
    console.log(
      `scene ${f.scene.index} (${f.scene.kind}): ${countWords(f.scene.narration)} words → ${f.durationSeconds.toFixed(2)}s  ${file}`,
    );
  }
  await writeFile(join(dir, "narration-manifest.json"), JSON.stringify(manifest, null, 2));

  const totalWithOpener = fit.totalSeconds + OPENER_SECONDS;
  console.log(`\nHeadline: ${fit.storyboard.headline}`);
  console.log(`Wrote bundle → ${dir}/`);
  console.log(`  article.json, storyboard.json, narration-manifest.json, ${manifest.length} scene mp3s`);
  console.log(
    `Fit in ${fit.rounds} round(s): ${fit.totalSeconds.toFixed(1)}s content + ${OPENER_SECONDS}s opener ` +
      `≈ ${totalWithOpener.toFixed(0)}s total (target ${SEGMENT_SECONDS}s)`,
  );
}

main().catch((err) => {
  console.error("preview error:", err.message ?? err);
  process.exit(1);
});
