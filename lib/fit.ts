/**
 * Duration fitting — make the segment land near its target length.
 *
 * Narration is the timing spine, but neither the LLM's word budgets nor a fixed
 * words-per-second constant predict ElevenLabs output well enough to hit a
 * wall-clock target. So we measure real TTS durations and correct:
 *
 *   1. Generate the storyboard and synthesize each scene's narration.
 *   2. If the measured total is outside tolerance of the target, compute a
 *      scale factor (target/actual), derive a hard per-scene word cap from each
 *      scene's CURRENT word count × scale, and ask the LLM to rewrite to those
 *      caps. Re-synthesize only the scenes whose narration changed.
 *   3. Repeat up to maxRounds. Because caps are derived from MEASURED durations,
 *      this self-corrects for both the model's overshoot and the voice's rate.
 *
 * Returns the final storyboard plus per-scene audio + measured durations, which
 * the pipeline reuses directly (no re-synthesis needed downstream).
 */
import { generateStoryboard, reviseNarration } from "@/lib/llm";
import { synthesizeNarration } from "@/lib/tts";
import {
  CONTENT_SECONDS,
  MIN_SCENE_SECONDS,
  MAX_SCENE_SECONDS,
  CLOSING_TAIL_SECONDS,
  wordsForSeconds,
} from "@/lib/timing";
import { log } from "@/lib/log";
import type { Article, Scene, Storyboard } from "@/lib/types";

/** Hard ceiling: a scene's video clip can be at most 10s on Runway. */
const HARD_MAX_SCENE_SECONDS = 10;
const MAX_WORDS_PER_SCENE = wordsForSeconds(MAX_SCENE_SECONDS);

export interface FittedScene {
  scene: Scene;
  audio: Buffer;
  durationSeconds: number;
}

export interface FitResult {
  storyboard: Storyboard;
  scenes: FittedScene[];
  totalSeconds: number;
  rounds: number;
}

export interface FitOptions {
  tier?: string | null;
  targetSeconds?: number; // content target (excludes opener)
  toleranceSeconds?: number;
  maxRounds?: number;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export async function fitStoryboard(
  article: Article,
  opts: FitOptions = {},
): Promise<FitResult> {
  const tier = opts.tier;
  const target = opts.targetSeconds ?? CONTENT_SECONDS;
  // Generous tolerance: only re-time when meaningfully off target, so we don't
  // trim narration mid-thought just to shave a few seconds. Anything in this
  // band reads naturally and stays well under a minute.
  const tolerance = opts.toleranceSeconds ?? 7;
  // Each round re-synthesizes changed scenes — and every TTS call is a billable
  // Runway *task* that counts against the daily task cap. Keep this low: with
  // 0.85 damping, 2 rounds lands within a few seconds of target on most articles.
  const maxRounds = opts.maxRounds ?? 2;

  const storyboard = await generateStoryboard(article, tier);

  // Initial synthesis of every scene — in parallel (each is its own TTS task).
  const fitted: FittedScene[] = await Promise.all(
    storyboard.scenes.map(async (scene) => {
      const { audio, durationSeconds } = await synthesizeNarration(scene.narration, tier);
      return { scene, audio, durationSeconds };
    }),
  );

  let total = fitted.reduce((s, f) => s + f.durationSeconds, 0);
  let rounds = 0;

  while (Math.abs(total - target) > tolerance && rounds < maxRounds) {
    rounds++;
    const rawScale = target / total;
    // Damp toward 1 to avoid over-correction, but move most of the way so large
    // overshoots converge within a few rounds.
    const scale = 1 + (rawScale - 1) * 0.85;
    const direction = rawScale < 1 ? "shorten" : "lengthen";
    log.info(
      `fit round ${rounds}: total ${total.toFixed(1)}s vs target ${target}s — ${direction} (scale ${scale.toFixed(2)})`,
    );

    const requests = fitted.map((f) => ({
      index: f.scene.index,
      narration: f.scene.narration,
      // Scale toward the target, but never ask for more than fits one clip.
      targetWords: Math.min(
        MAX_WORDS_PER_SCENE,
        Math.max(8, Math.round(wordCount(f.scene.narration) * scale)),
      ),
    }));
    // Provide article context only when lengthening (so added detail is factual).
    const revisions = await reviseNarration(
      requests,
      tier,
      rawScale > 1 ? article.body : undefined,
    );

    await Promise.all(
      fitted.map(async (f) => {
        const next = revisions.get(f.scene.index);
        if (next && next.trim() && next !== f.scene.narration) {
          f.scene.narration = next;
          const { audio, durationSeconds } = await synthesizeNarration(next, tier);
          f.audio = audio;
          f.durationSeconds = durationSeconds;
        }
      }),
    );

    total = fitted.reduce((s, f) => s + f.durationSeconds, 0);
  }

  // Enforce the hard per-scene cap: any scene whose narration still exceeds the
  // 10s clip limit gets one shorten-only pass (the global scale can leave an
  // individual scene long even when the total is on target).
  const overLong = fitted.filter((f) => f.durationSeconds > HARD_MAX_SCENE_SECONDS);
  if (overLong.length) {
    log.info(`enforcing per-scene cap on ${overLong.length} long scene(s)`);
    const revisions = await reviseNarration(
      overLong.map((f) => ({
        index: f.scene.index,
        narration: f.scene.narration,
        targetWords: MAX_WORDS_PER_SCENE,
      })),
      tier,
    );
    await Promise.all(
      overLong.map(async (f) => {
        const next = revisions.get(f.scene.index);
        if (next && next.trim()) {
          f.scene.narration = next;
          const { audio, durationSeconds } = await synthesizeNarration(next, tier);
          f.audio = audio;
          f.durationSeconds = durationSeconds;
        }
      }),
    );
    total = fitted.reduce((s, f) => s + f.durationSeconds, 0);
  }

  // Snap each scene's targetSeconds to its measured duration, clamped to the
  // Runway clip range so downstream video stages have a valid length. The clip
  // is at least as long as the narration (rounded up) so speech is never cut.
  // The final scene gets an extra hold so the segment ends on a clean beat
  // rather than cutting the instant the last word lands.
  fitted.forEach((f, idx) => {
    const tail = idx === fitted.length - 1 ? CLOSING_TAIL_SECONDS : 0;
    f.scene.targetSeconds = Math.min(
      HARD_MAX_SCENE_SECONDS,
      Math.max(MIN_SCENE_SECONDS, Math.ceil(f.durationSeconds + tail)),
    );
  });

  log.info(`fit done: ${total.toFixed(1)}s content over ${rounds} round(s)`);
  return { storyboard, scenes: fitted, totalSeconds: total, rounds };
}
