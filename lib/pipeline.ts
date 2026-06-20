/**
 * Step 8 — End-to-end pipeline (no UI).
 *
 * runPipeline(url) chains every stage into one finished segment:
 *   1. extract article            (lib/extract)
 *   2. fit storyboard + narration (lib/fit → lib/llm + lib/tts, targets 41s)
 *   3. per scene, in parallel:
 *        a. nano-banana keyframe   (lib/runway.generateFrame)
 *        b. anchor + lipSync.enabled → lip-synced talking head (audio embedded)
 *           else → image-to-video clip, then mux the scene's narration over it
 *   4. stitch: opener + scene clips with chyron/logo overlays (lib/compose)
 *
 * Returns the final MP4 path plus metadata. The worker (Step 9) calls this.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { extractArticle } from "@/lib/extract";
import { fitStoryboard } from "@/lib/fit";
import { generateFrame, animateImage, lipSyncAnchor } from "@/lib/runway";
import { buildSegment, muxNarration, stillToClip, type SegmentScene } from "@/lib/compose";
import { models } from "@/lib/models";
import { CONTENT_SECONDS } from "@/lib/timing";
import { log } from "@/lib/log";
import type { Article, Storyboard } from "@/lib/types";

export interface PipelineResult {
  outputPath: string;
  article: Article;
  storyboard: Storyboard;
  contentSeconds: number;
}

export type PipelineStage =
  | "extracting"
  | "scripting"
  | "generating"
  | "stitching"
  | "completed";

export interface PipelineOptions {
  tier?: string | null;
  /** Working directory for intermediate artifacts. */
  workDir: string;
  /** Final output path. */
  outputPath: string;
  /** Branded opener to prepend. */
  openerPath?: string;
  /** Coarse progress callback for UIs (stage + 0–100%). */
  onProgress?: (stage: PipelineStage, pct: number) => void;
  /** Called once the article is extracted (for persistence). */
  onArticle?: (article: Article) => void;
  /** Called once the storyboard is written (for persistence). */
  onStoryboard?: (storyboard: Storyboard) => void;
}

export async function runPipeline(
  url: string,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const tier = opts.tier;
  const m = models(tier);
  const openerPath = opts.openerPath ?? "brand/opener.mp4";
  const progress = opts.onProgress ?? (() => {});
  await mkdir(opts.workDir, { recursive: true });

  log.info(`pipeline: extracting ${url}`);
  progress("extracting", 5);
  const article = await extractArticle(url);
  opts.onArticle?.(article);

  log.info("pipeline: scripting + fitting narration");
  progress("scripting", 20);
  const fit = await fitStoryboard(article, { tier, targetSeconds: CONTENT_SECONDS });
  opts.onStoryboard?.(fit.storyboard);

  // Canonical anchor reference keeps the same anchor across all anchor scenes.
  const anchorRef = existsSync("brand/anchor.png")
    ? [await readFile("brand/anchor.png")]
    : undefined;

  // Each scene → a clip with its audio, produced concurrently.
  log.info(`pipeline: generating ${fit.scenes.length} scenes (tier=${tier ?? "draft"})`);
  progress("generating", 40);
  const scenes: SegmentScene[] = await Promise.all(
    fit.scenes.map(async (f): Promise<SegmentScene> => {
      const i = f.scene.index;

      if (f.scene.kind === "anchor" && m.lipSync.enabled) {
        // Lip-synced talking anchor driven by a custom avatar of the brand
        // anchor (falls back to a preset if anchor.png isn't available).
        const clip = await lipSyncAnchor(f.audio, { tier, anchorImage: anchorRef?.[0] });
        const clipPath = join(opts.workDir, `scene-${i}-lipsync.mp4`);
        await writeFile(clipPath, clip.video);
        return { clipPath, chyron: f.scene.chyron };
      }

      // Frame → animate → mux narration over the (silent) clip. Anchor scenes
      // pass the canonical anchor reference for a consistent on-screen anchor.
      // If a B-roll prompt is blocked (content moderation), fall back to the
      // anchor visual so one bad scene doesn't fail the whole segment.
      const useAnchorRef = f.scene.kind === "anchor";
      let frameImage: Buffer;
      try {
        frameImage = (
          await generateFrame(f.scene.prompt, {
            tier,
            referenceImages: useAnchorRef ? anchorRef : undefined,
          })
        ).image;
      } catch (err) {
        log.warn(`scene ${i} frame failed (${(err as Error).message})`);
        if (!anchorRef) throw err;
        log.warn(`scene ${i}: falling back to anchor visual`);
        frameImage = anchorRef[0];
      }
      const silentPath = join(opts.workDir, `scene-${i}-silent.mp4`);
      const audioPath = join(opts.workDir, `scene-${i}.mp3`);
      const clipPath = join(opts.workDir, `scene-${i}.mp4`);

      if (m.animate.enabled) {
        // Paid path: animate the frame into motion (image-to-video).
        const clip = await animateImage(frameImage, f.scene.targetSeconds, {
          tier,
          prompt: f.scene.prompt,
        });
        await writeFile(silentPath, clip.video);
      } else {
        // Cost-saver: hold on the still frame for the scene duration (free).
        const framePath = join(opts.workDir, `scene-${i}-frame.png`);
        await writeFile(framePath, frameImage);
        await stillToClip(framePath, f.scene.targetSeconds, silentPath);
      }

      await writeFile(audioPath, f.audio);
      await muxNarration(silentPath, audioPath, clipPath);
      return { clipPath, chyron: f.scene.chyron };
    }),
  );

  log.info("pipeline: stitching final segment");
  progress("stitching", 85);
  await buildSegment({ openerPath, scenes, outputPath: opts.outputPath, workDir: opts.workDir });
  progress("completed", 100);

  return {
    outputPath: opts.outputPath,
    article,
    storyboard: fit.storyboard,
    contentSeconds: fit.totalSeconds,
  };
}
