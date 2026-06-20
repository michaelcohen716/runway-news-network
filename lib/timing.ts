/**
 * Segment timing budget — single source of truth.
 *
 * The total segment is the fixed opener plus the narrated scenes. Narration is
 * the timing spine, so we budget each scene's words by an empirical speaking
 * rate (measured from ElevenLabs output: ~2.6 words/sec for our voice/model).
 */
export const SEGMENT_SECONDS = 41; // total target length of the finished clip
export const OPENER_SECONDS = 5; // fixed RNN opener prepended to every segment
export const CONTENT_SECONDS = SEGMENT_SECONDS - OPENER_SECONDS; // narrated scenes

/** Empirical speaking rate of the configured TTS voice (words per second).
 * Measured from ElevenLabs flash v2.5 / Matilda: ~2.4 wps including cadence. */
export const WORDS_PER_SECOND = 2.4;

/** Total narration word budget for the whole segment. */
export const TOTAL_WORD_BUDGET = Math.round(CONTENT_SECONDS * WORDS_PER_SECOND);

/** Per-scene duration bounds (Runway clips are capped at 2–10s). */
export const MIN_SCENE_SECONDS = 5;
export const MAX_SCENE_SECONDS = 9;

/** Approx words that fit in a scene of the given length at our speaking rate. */
export function wordsForSeconds(seconds: number): number {
  return Math.round(seconds * WORDS_PER_SECOND);
}
