/**
 * Supabase persistence (best-effort).
 *
 * Every request is mirrored to Supabase: inputs (url/tier/article), generated
 * components (storyboard + scenes), pipeline logs, and the final video (uploaded
 * to the `segments` storage bucket). Writes use the service-role key and are
 * server-only.
 *
 * Persistence is intentionally best-effort: if Supabase is unconfigured or a
 * write fails, we log and continue — the generated segment is the product, the
 * DB is a mirror. (Failures here use `console` directly, never `log`, to avoid
 * recursing through the per-job log sink.)
 */
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Article, Storyboard } from "@/lib/types";
import type { LogLevel } from "@/lib/log";

// supabase-js constructs a realtime client that needs a global WebSocket.
// Node < 22 (and the tsx worker/scripts) lack one, so polyfill it; the Next
// server already provides WebSocket, where this is a harmless no-op.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  // Lazy require so bundlers don't pull `ws` into edge/browser builds.
  (globalThis as { WebSocket?: unknown }).WebSocket =
    require("ws").WebSocket as unknown;
}

export const SEGMENT_BUCKET = "segments";

let _client: SupabaseClient | null = null;

/** The service-role client, or null if Supabase isn't configured. */
export function db(): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export function dbEnabled(): boolean {
  return !!db();
}

/** A past generation as shown on the archive index. */
export interface ArchiveJob {
  id: string;
  sourceUrl: string;
  tier: string | null;
  status: string;
  headline: string | null;
  summary: string | null;
  videoUrl: string | null;
  errorCode: string | null;
  createdAt: number;
}

/** One job's full row (incl. storyboard), or null. Used as a fallback when the
 *  in-memory store has been cleared by a restart. */
export async function getJobRow(id: string): Promise<Record<string, unknown> | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from("jobs")
      .select(
        "id,source_url,tier,status,progress,headline,summary,storyboard,video_url,error,error_code,created_at,updated_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      warn("getJobRow", error);
      return null;
    }
    return data ?? null;
  } catch (err) {
    warn("getJobRow", err);
    return null;
  }
}

/** All past generations, newest first, straight from the DB. */
export async function listJobsFromDb(limit = 200): Promise<ArchiveJob[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("jobs")
      .select("id,source_url,tier,status,headline,summary,video_url,error_code,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      warn("listJobsFromDb", error);
      return [];
    }
    return (data ?? []).map((r) => ({
      id: r.id as string,
      sourceUrl: r.source_url as string,
      tier: (r.tier as string | null) ?? null,
      status: r.status as string,
      headline: (r.headline as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      videoUrl: (r.video_url as string | null) ?? null,
      errorCode: (r.error_code as string | null) ?? null,
      createdAt: Date.parse(r.created_at as string),
    }));
  } catch (err) {
    warn("listJobsFromDb", err);
    return [];
  }
}

function warn(label: string, err: unknown) {
  // console directly — using log here could recurse via the job log sink.
  console.error(`[db] ${label} failed:`, (err as Error)?.message ?? err);
}

/** Insert the job row at creation time (captures the inputs). */
export async function insertJob(input: {
  id: string;
  sourceUrl: string;
  tier: string | null;
}): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from("jobs").insert({
      id: input.id,
      source_url: input.sourceUrl,
      tier: input.tier,
      status: "queued",
      progress: 0,
    });
    if (error) warn("insertJob", error);
  } catch (err) {
    warn("insertJob", err);
  }
}

/** Columns the pipeline updates over a job's lifetime. */
export interface JobPatch {
  status?: string;
  progress?: number;
  headline?: string;
  summary?: string;
  contentSeconds?: number;
  videoUrl?: string;
  videoPath?: string;
  error?: string;
  errorCode?: string;
}

export async function updateJob(id: string, patch: JobPatch): Promise<void> {
  const c = db();
  if (!c) return;
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress;
  if (patch.headline !== undefined) row.headline = patch.headline;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.contentSeconds !== undefined) row.content_seconds = patch.contentSeconds;
  if (patch.videoUrl !== undefined) row.video_url = patch.videoUrl;
  if (patch.videoPath !== undefined) row.video_path = patch.videoPath;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (Object.keys(row).length === 0) return;
  try {
    const { error } = await c.from("jobs").update(row).eq("id", id);
    if (error) warn("updateJob", error);
  } catch (err) {
    warn("updateJob", err);
  }
}

/** Save the extracted article (the request's input content). */
export async function saveArticle(id: string, article: Article): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from("jobs").update({ article }).eq("id", id);
    if (error) warn("saveArticle", error);
  } catch (err) {
    warn("saveArticle", err);
  }
}

/** Save the generated storyboard + explode its scenes into the components table. */
export async function saveStoryboard(id: string, storyboard: Storyboard): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    const { error: jErr } = await c
      .from("jobs")
      .update({ storyboard, headline: storyboard.headline, summary: storyboard.summary })
      .eq("id", id);
    if (jErr) warn("saveStoryboard(job)", jErr);

    const rows = storyboard.scenes.map((s) => ({
      job_id: id,
      idx: s.index,
      kind: s.kind,
      prompt: s.prompt,
      narration: s.narration,
      chyron: s.chyron,
      target_seconds: s.targetSeconds,
    }));
    if (rows.length) {
      const { error: sErr } = await c.from("scenes").insert(rows);
      if (sErr) warn("saveStoryboard(scenes)", sErr);
    }
  } catch (err) {
    warn("saveStoryboard", err);
  }
}

/** Bulk-insert a batch of pipeline log lines for a job. */
export async function insertLogs(
  jobId: string,
  entries: { level: LogLevel; message: string }[],
): Promise<void> {
  const c = db();
  if (!c || entries.length === 0) return;
  try {
    const { error } = await c
      .from("job_logs")
      .insert(entries.map((e) => ({ job_id: jobId, level: e.level, message: e.message })));
    if (error) warn("insertLogs", error);
  } catch (err) {
    warn("insertLogs", err);
  }
}

/**
 * Upload the finished MP4 to the segments bucket and return its public URL +
 * storage path. Returns null if Supabase isn't configured or the upload fails.
 */
export async function uploadSegment(
  id: string,
  localPath: string,
): Promise<{ publicUrl: string; path: string } | null> {
  const c = db();
  if (!c) return null;
  const path = `${id}.mp4`;
  try {
    const file = await readFile(localPath);
    const { error } = await c.storage
      .from(SEGMENT_BUCKET)
      .upload(path, file, { contentType: "video/mp4", upsert: true });
    if (error) {
      warn("uploadSegment", error);
      return null;
    }
    const { data } = c.storage.from(SEGMENT_BUCKET).getPublicUrl(path);
    return { publicUrl: data.publicUrl, path };
  } catch (err) {
    warn("uploadSegment", err);
    return null;
  }
}
