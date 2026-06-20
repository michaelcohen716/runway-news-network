/**
 * Shared types across web + worker. The storyboard schema is the contract
 * between the LLM script stage and every downstream media stage.
 */
import { z } from "zod";

/** A scene is either the AI anchor on-camera or illustrative B-roll. */
export const SceneKind = z.enum(["anchor", "broll"]);
export type SceneKind = z.infer<typeof SceneKind>;

export const SceneSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: SceneKind,
  /** Image-generation prompt for this scene's keyframe. */
  prompt: z.string().min(1),
  /** Narration spoken over this scene (the TTS timing spine). */
  narration: z.string().min(1),
  /** Lower-third / chyron text shown on screen. */
  chyron: z.string().default(""),
  /** Target duration in seconds (2–10, capped by Runway). */
  targetSeconds: z.number().min(2).max(10),
  /** Word count budget the narration was written to (for pacing checks). */
  wordBudget: z.number().int().positive().optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const StoryboardSchema = z.object({
  headline: z.string().min(1),
  /** One-line summary of the story, for the chyron/ticker. */
  summary: z.string().min(1),
  scenes: z.array(SceneSchema).min(2).max(6),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

/** Cleaned article produced by the extraction stage. */
export interface Article {
  url: string;
  title: string;
  body: string;
  byline?: string;
  publishedAt?: string;
  leadImage?: string;
  siteName?: string;
}

export type JobStatus =
  | "queued"
  | "extracting"
  | "scripting"
  | "generating"
  | "stitching"
  | "completed"
  | "failed";
