/**
 * Step 2 — Deconstruct the article into a broadcast storyboard.
 *
 * Uses Claude (model chosen by the active quality tier) to turn a cleaned
 * article into a structured storyboard: anchor intro + 3–5 scene beats, each
 * with a narration line, an image prompt, chyron text, and a target duration.
 *
 * Reliability approach: forced tool use (`tool_choice: {type:"tool"}`) with a
 * hand-written JSON Schema for the tool input, then validate the model's output
 * against the Zod `StoryboardSchema` (lib/types.ts). This decouples us from any
 * zod<->SDK-helper version coupling and gives us a single source of truth for
 * the shape.
 */
import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/lib/env";
import { models } from "@/lib/models";
import { log } from "@/lib/log";
import { StoryboardSchema, type Article, type Storyboard } from "@/lib/types";
import {
  CONTENT_SECONDS,
  MIN_SCENE_SECONDS,
  MAX_SCENE_SECONDS,
  WORDS_PER_SECOND,
  TOTAL_WORD_BUDGET,
  wordsForSeconds,
} from "@/lib/timing";

const SYSTEM_PROMPT = `You are the segment producer for "Runway News Network" (RNN), a self-serious nightly cable news show. Given a news article, you write a tight ~${CONTENT_SECONDS}-second broadcast segment reporting on it.

CRITICAL — narration length is the hard constraint (overlong narration breaks the segment):
- The narration is read aloud at about ${WORDS_PER_SECOND} words per second.
- The ENTIRE segment's narration across all scenes must total NO MORE THAN ${TOTAL_WORD_BUDGET} words. Count the words. Staying under is better than going over.
- Per scene, a scene that is N seconds long holds about ${WORDS_PER_SECOND}×N words: a ${MIN_SCENE_SECONDS}s scene ≈ ${wordsForSeconds(MIN_SCENE_SECONDS)} words, a ${MAX_SCENE_SECONDS}s scene ≈ ${wordsForSeconds(MAX_SCENE_SECONDS)} words.
- Set "wordBudget" for each scene to round(${WORDS_PER_SECOND} × targetSeconds), and keep that scene's narration at or below its wordBudget. The wordBudgets must sum to ≤ ${TOTAL_WORD_BUDGET}.
- Favor short, declarative sentences. Cut adjectives and clauses before exceeding budget.

Structure:
- Open with the anchor (kind "anchor") at the desk, then cut to illustrative B-roll scenes (kind "broll"); you may return to the anchor to close.
- 4 to 5 scenes total. Each scene's targetSeconds is between ${MIN_SCENE_SECONDS} and ${MAX_SCENE_SECONDS}, and ALL targetSeconds must sum to about ${CONTENT_SECONDS} (±3).

Per-field rules:
- narration: terse broadcast copy, factual to the article, no invented quotes or facts. Punchy news-anchor cadence. Respect the word budget above.
- prompt: a vivid visual description for an AI image generator. For anchor scenes, describe the anchor at a broadcast desk; for B-roll, describe the story's subject. The image must contain NO text, captions, lower-thirds, chyrons, tickers, logos, watermarks, or network branding of any kind — those are added in post. Describe photorealistic broadcast footage.
  IMPORTANT (image safety — or generation is blocked): do NOT name or depict real, identifiable public figures, politicians, or celebrities; depict generic, representative people instead (e.g. "diplomats shaking hands at a summit", "officials at a podium"). Avoid graphic violence, gore, weapons aimed at people, injury, or disturbing imagery — keep every shot broadcast-safe and suggestive rather than explicit (e.g. "smoke rising over a city skyline at dusk" instead of a depiction of casualties).
- chyron: a short lower-third headline (a few words), like a real news ticker.
- Keep it grounded in the article. Do not fabricate.`;

/** JSON Schema for the forced tool. Mirrors StoryboardSchema in lib/types.ts. */
const STORYBOARD_TOOL: Anthropic.Tool = {
  name: "emit_storyboard",
  description: "Return the structured RNN broadcast storyboard for this story.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", description: "The segment headline." },
      summary: {
        type: "string",
        description: "One-line summary of the story for the ticker.",
      },
      scenes: {
        type: "array",
        description: "3–5 ordered scenes.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["anchor", "broll"] },
            prompt: { type: "string", description: "Image-generation prompt." },
            narration: { type: "string", description: "Spoken narration." },
            chyron: { type: "string", description: "Lower-third headline text." },
            targetSeconds: {
              type: "number",
              description: `Scene duration in seconds (${MIN_SCENE_SECONDS}–${MAX_SCENE_SECONDS}).`,
            },
            wordBudget: {
              type: "integer",
              description: "round(words-per-second × targetSeconds); narration must not exceed this.",
            },
          },
          required: ["kind", "prompt", "narration", "chyron", "targetSeconds", "wordBudget"],
        },
      },
    },
    required: ["headline", "summary", "scenes"],
  },
};

export async function generateStoryboard(
  article: Article,
  tierOverride?: string | null,
): Promise<Storyboard> {
  const { ANTHROPIC_API_KEY } = requireEnv("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const m = models(tierOverride);

  // Keep the article body bounded so we don't blow the context / cost.
  const body = article.body.slice(0, 8000);
  const userContent = [
    `TITLE: ${article.title}`,
    article.byline ? `BYLINE: ${article.byline}` : null,
    article.siteName ? `SOURCE: ${article.siteName}` : null,
    "",
    body,
  ]
    .filter((l) => l !== null)
    .join("\n");

  log.info(`generating storyboard with ${m.llm.model}`);
  const response = await client.messages.create({
    model: m.llm.model,
    max_tokens: m.llm.maxTokens,
    system: SYSTEM_PROMPT,
    tools: [STORYBOARD_TOOL],
    tool_choice: { type: "tool", name: "emit_storyboard" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("LLM did not return a storyboard tool call");
  }

  // The model returns scenes without an index; assign indices, then validate.
  const raw = toolUse.input as { scenes?: unknown[] };
  const withIndices = {
    ...(raw as object),
    scenes: (raw.scenes ?? []).map((s, index) => ({
      ...(s as object),
      index,
    })),
  };

  const parsed = StoryboardSchema.safeParse(withIndices);
  if (!parsed.success) {
    throw new Error(
      `storyboard failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

/** A scene whose narration should be rewritten toward a target word count. */
export interface NarrationRevisionRequest {
  index: number;
  narration: string;
  targetWords: number;
}

const REVISE_TOOL: Anthropic.Tool = {
  name: "emit_revisions",
  description: "Return the rewritten, shortened narration for each scene.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      revisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            narration: { type: "string" },
          },
          required: ["index", "narration"],
        },
      },
    },
    required: ["revisions"],
  },
};

/**
 * Corrective pass used by the fit loop: rewrite each scene's narration toward a
 * target word count. Shortening cuts adjectives/clauses; lengthening may add
 * factual detail drawn ONLY from the provided article context (never invented).
 * Returns a map of scene index → new narration.
 */
export async function reviseNarration(
  requests: NarrationRevisionRequest[],
  tierOverride?: string | null,
  articleContext?: string,
): Promise<Map<number, string>> {
  const { ANTHROPIC_API_KEY } = requireEnv("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const m = models(tierOverride);

  const lines = requests
    .map((r) => `Scene ${r.index} (TARGET ~${r.targetWords} words): ${r.narration}`)
    .join("\n\n");
  const userContent = articleContext
    ? `ARTICLE (for factual detail only):\n${articleContext.slice(0, 4000)}\n\n---\nSCENES:\n${lines}`
    : lines;

  const response = await client.messages.create({
    model: m.llm.model,
    max_tokens: m.llm.maxTokens,
    system:
      "You re-time broadcast news narration. Rewrite each scene's narration to ABOUT its target word count (within ~2 words). When shortening, cut adjectives and clauses but keep the key facts. When lengthening, add only factual detail supported by the provided article — never invent facts, names, or numbers. Keep a punchy news-anchor tone.",
    tools: [REVISE_TOOL],
    tool_choice: { type: "tool", name: "emit_revisions" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("revision pass returned no tool call");

  const input = toolUse.input as {
    revisions?: Array<{ index: number; narration: string }>;
  };
  const out = new Map<number, string>();
  for (const r of input.revisions ?? []) out.set(r.index, r.narration);
  return out;
}
