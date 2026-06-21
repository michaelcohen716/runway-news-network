/**
 * In-memory job store for the web app (non-paid stand-in for the Supabase-backed
 * worker queue of Step 9). Each job runs runPipeline() in the background within
 * the Next server process; the finished MP4 is written to public/segments/<id>.mp4
 * so it can be served statically and played in the result page.
 *
 * NOTE: in-memory means jobs are lost on restart and won't survive multiple
 * processes — fine for a single self-hosted `next start`. Step 9 replaces this
 * with `jobs`/`scenes` tables + the standalone worker.
 */
import { mkdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runPipeline, type PipelineStage } from "@/lib/pipeline";
import { log, withLogSink, type LogLevel } from "@/lib/log";
import { ExtractionError, type ExtractCode } from "@/lib/extract";
import {
  insertJob,
  updateJob,
  saveArticle,
  saveStoryboard,
  insertLogs,
  uploadSegment,
  getJobRow,
} from "@/lib/db";
import type { Storyboard } from "@/lib/types";

export interface Job {
  id: string;
  sourceUrl: string;
  tier: string | null;
  status: "queued" | PipelineStage | "failed";
  progress: number;
  headline?: string;
  videoUrl?: string;
  storyboard?: Storyboard;
  error?: string;
  errorCode?: ExtractCode | "generation";
  createdAt: number;
}

const jobs = new Map<string, Job>();

/** A DB job in progress but untouched for this long is considered dead (the
 *  server restarted). Live jobs heartbeat well within this window. */
const STALE_JOB_MS = 3 * 60 * 1000;

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** All jobs, newest first — backs the dashboard feed and the archive grid. */
export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** The JSON shape sent to the browser (the contract for every job view). */
export interface JobView {
  id: string;
  sourceUrl: string;
  tier: string | null;
  status: Job["status"];
  progress: number;
  headline: string | null;
  summary: string | null;
  keyPoints: string[];
  videoUrl: string | null;
  error: string | null;
  errorCode: string | null;
  createdAt: number;
}

/**
 * Resolve a job for the browser: prefer the live in-memory job (has real-time
 * progress), else fall back to the persisted DB row so completed segments still
 * resolve after a server restart.
 */
export async function getJobView(id: string): Promise<JobView | null> {
  const mem = getJob(id);
  if (mem) return serializeJob(mem);

  const row = await getJobRow(id);
  if (!row) return null;
  const sb = row.storyboard as Storyboard | null;

  // A job that's "in progress" in the DB but not in memory and hasn't been
  // touched recently was killed (server restart/deploy) — surface it as failed
  // instead of polling "generating" forever. Live jobs heartbeat every ~45s.
  let status = row.status as JobView["status"];
  let error = (row.error as string | null) ?? null;
  let errorCode = (row.error_code as string | null) ?? null;
  const inProgress = !["completed", "failed"].includes(status);
  if (inProgress) {
    const updatedAt = Date.parse((row.updated_at as string) ?? (row.created_at as string));
    if (Date.now() - updatedAt > STALE_JOB_MS) {
      status = "failed";
      error = "Generation was interrupted (the server restarted). Please try again.";
      errorCode = "generation";
    }
  }

  return {
    id: row.id as string,
    sourceUrl: row.source_url as string,
    tier: (row.tier as string | null) ?? null,
    status,
    progress: (row.progress as number | null) ?? 0,
    headline: (row.headline as string | null) ?? sb?.headline ?? null,
    summary: (row.summary as string | null) ?? sb?.summary ?? null,
    keyPoints: sb?.scenes.map((s) => s.chyron).filter(Boolean) ?? [],
    videoUrl: (row.video_url as string | null) ?? null,
    error,
    errorCode,
    createdAt: Date.parse(row.created_at as string),
  };
}

export function serializeJob(job: Job): JobView {
  return {
    id: job.id,
    sourceUrl: job.sourceUrl,
    tier: job.tier,
    status: job.status,
    progress: job.progress,
    headline: job.headline ?? null,
    summary: job.storyboard?.summary ?? null,
    keyPoints: job.storyboard?.scenes.map((s) => s.chyron).filter(Boolean) ?? [],
    videoUrl: job.videoUrl ?? null,
    error: job.error ?? null,
    errorCode: job.errorCode ?? null,
    createdAt: job.createdAt,
  };
}

export function createJob(sourceUrl: string, tier: string | null): Job {
  const id = randomUUID();
  const job: Job = {
    id,
    sourceUrl,
    tier,
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  // Mirror the request's inputs to the DB, then run (both fire-and-forget;
  // the route returns immediately with the job id).
  void insertJob({ id, sourceUrl, tier });
  void run(job);
  return job;
}

async function run(job: Job): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), `rnn-job-${job.id}-`));
  const publicDir = join(process.cwd(), "public", "segments");
  const outputPath = join(publicDir, `${job.id}.mp4`);

  // Buffer pipeline log lines and flush them to the DB in batches (so a crash
  // mid-pipeline still persists what happened up to that point).
  const logBuf: { level: LogLevel; message: string }[] = [];
  const flushLogs = () => {
    if (logBuf.length === 0) return;
    const batch = logBuf.splice(0, logBuf.length);
    void insertLogs(job.id, batch);
  };

  // Heartbeat: keep the DB row's updated_at fresh while the (possibly long,
  // quiet) generating stage runs, so getJobView can tell live jobs from dead
  // ones killed by a restart.
  const heartbeat = setInterval(() => {
    void updateJob(job.id, { progress: job.progress });
  }, 45_000);

  await withLogSink(
    (level, message) => {
      logBuf.push({ level, message });
      if (logBuf.length >= 5) flushLogs();
    },
    async () => {
      try {
        await mkdir(publicDir, { recursive: true });
        job.status = "extracting";
        void updateJob(job.id, { status: "extracting", progress: 5 });

        const result = await runPipeline(job.sourceUrl, {
          tier: job.tier,
          workDir: work,
          outputPath,
          onProgress: (stage, pct) => {
            job.status = stage;
            job.progress = pct;
            void updateJob(job.id, { status: stage, progress: pct });
          },
          onArticle: (article) => void saveArticle(job.id, article),
          onStoryboard: (storyboard) => void saveStoryboard(job.id, storyboard),
        });

        job.headline = result.storyboard.headline;
        job.storyboard = result.storyboard;
        job.progress = 100;

        // Persist the finished video to storage; prefer its public URL so it
        // survives restarts, falling back to the locally-served file.
        const uploaded = await uploadSegment(job.id, outputPath);
        job.videoUrl = uploaded?.publicUrl ?? `/segments/${job.id}.mp4`;
        job.status = "completed";

        await updateJob(job.id, {
          status: "completed",
          progress: 100,
          headline: job.headline,
          contentSeconds: result.contentSeconds,
          videoUrl: job.videoUrl,
          videoPath: uploaded?.path,
        });
        log.info(`job ${job.id} completed: ${job.headline}`);
      } catch (err) {
        job.status = "failed";
        job.error = (err as Error).message;
        job.errorCode = err instanceof ExtractionError ? err.code : "generation";
        log.error(`job ${job.id} failed`, job.error);
        await updateJob(job.id, {
          status: "failed",
          error: job.error,
          errorCode: job.errorCode,
        });
      } finally {
        clearInterval(heartbeat);
        flushLogs();
        await rm(work, { recursive: true, force: true });
      }
    },
  );
}
