"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shell, Icon } from "../../components/Chrome";
import { hostOf, errorLabel, errorIcon, type JobView } from "../../lib/jobView";
import { FINAL_ONLY } from "@/lib/flags";

const STAGES = [
  {
    key: "extracting",
    label: "Reading the story",
    icon: "travel_explore",
    ticks: ["Fetching source", "Stripping boilerplate", "Parsing article body"],
  },
  {
    key: "scripting",
    label: "Writing the segment",
    icon: "edit_note",
    ticks: ["Deconstructing the story", "Drafting narration", "Timing the read"],
  },
  {
    key: "generating",
    label: "Generating footage",
    icon: "movie_edit",
    ticks: ["Rendering keyframes", "Synthesizing the anchor", "Animating scenes", "Voicing narration"],
  },
  {
    key: "stitching",
    label: "Assembling broadcast",
    icon: "auto_awesome_motion",
    ticks: ["Adding opener", "Overlaying chyrons", "Encoding broadcast"],
  },
];

function stageIndex(status: string): number {
  if (status === "queued") return -1;
  if (status === "completed") return STAGES.length;
  return STAGES.findIndex((s) => s.key === status);
}

/** Minimal shape of a past broadcast used by the showcase (from /api/archive). */
interface ShowcaseItem {
  id: string;
  headline: string | null;
  sourceUrl: string;
  videoUrl: string | null;
  tier: string | null;
  status: string;
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SegmentView({ id }: { id: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState(0);

  // "While you wait" showcase of past broadcasts (from the DB archive).
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [scIdx, setScIdx] = useState(0);
  const [scMuted, setScMuted] = useState(true);
  const scVideoRef = useRef<HTMLVideoElement>(null);

  const inProgress =
    !!job && job.status !== "completed" && job.status !== "failed";

  // Load past completed broadcasts to play while this one generates.
  useEffect(() => {
    let active = true;
    fetch("/api/archive")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const items: ShowcaseItem[] = (d.jobs ?? []).filter(
          (j: ShowcaseItem) =>
            j.status === "completed" &&
            j.videoUrl &&
            j.id !== id &&
            (!FINAL_ONLY || j.tier === "final"),
        );
        setShowcase(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  // Keep mute in sync across auto-advances (avoids React's muted-prop quirk).
  useEffect(() => {
    if (scVideoRef.current) scVideoRef.current.muted = scMuted;
  }, [scMuted, scIdx]);

  const scCurrent = showcase.length ? showcase[scIdx % showcase.length] : null;
  const stepShowcase = (dir: 1 | -1) =>
    setScIdx((i) => (showcase.length ? (i + dir + showcase.length) % showcase.length : 0));

  // Elapsed clock + rotating sub-status, only while producing.
  useEffect(() => {
    if (!inProgress) return;
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);
    const ticker = setInterval(() => setTick((t) => t + 1), 2600);
    return () => {
      clearInterval(clock);
      clearInterval(ticker);
    };
  }, [inProgress]);

  useEffect(() => {
    let active = true;
    async function poll() {
      const res = await fetch(`/api/jobs/${id}`);
      if (!active) return;
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data: JobView = await res.json();
      setJob(data);
      if (data.status !== "completed" && data.status !== "failed") {
        setTimeout(poll, 2000);
      }
    }
    poll();
    return () => {
      active = false;
    };
  }, [id]);

  const done = job?.status === "completed";
  const failed = job?.status === "failed";
  const current = job ? stageIndex(job.status) : -1;

  return (
    <Shell>
      <div className="mx-auto w-full max-w-2xl flex-1 px-md py-xl">
        {notFound ? (
          <div className="glass-panel flex flex-col items-center gap-md p-xl text-center">
            <Icon name="signal_disconnected" className="text-5xl text-outline" />
            <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
              That segment doesn’t exist — the server may have restarted.
            </p>
            <Link
              href="/"
              className="bg-primary-container px-lg py-sm font-label-caps text-label-caps uppercase text-on-primary-container transition-all hover:brightness-110"
            >
              Start a New Broadcast
            </Link>
          </div>
        ) : (
          job && (
            <>
              {/* Status line */}
              <div className="flex items-center gap-sm font-label-caps text-[10px] uppercase tracking-widest">
                <span
                  className={`h-2 w-2 rounded-full bg-primary-container ${
                    done ? "" : "live-blink"
                  }`}
                />
                <span className="text-primary">
                  {done ? "Ready" : failed ? "Failed" : "Producing"}
                </span>
                <span className="text-outline">·</span>
                <span className="text-on-surface-variant">
                  {job.tier === "final" ? "Final" : "Draft"} · 30s
                </span>
              </div>

              <h1 className="mt-sm font-display-lg text-headline-lg leading-tight text-on-surface">
                {job.headline ??
                  (failed ? "Couldn’t produce this segment" : "Producing your segment…")}
              </h1>
              <a
                href={job.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-xs inline-block break-all font-body-md text-sm text-tertiary hover:underline"
              >
                {hostOf(job.sourceUrl)}
              </a>

              {/* State orchestration */}
              {!done && !failed && (
                <div className="glass-panel mt-lg p-lg">
                  <div className="space-y-xs">
                    {STAGES.map((s, i) => {
                      const state =
                        i < current ? "done" : i === current ? "active" : "todo";
                      const subStatus =
                        state === "active"
                          ? s.ticks[tick % s.ticks.length]
                          : null;
                      return (
                        <div
                          key={s.key}
                          className={`relative flex items-center gap-md overflow-hidden rounded-sm px-sm py-sm transition-colors ${
                            state === "active" ? "bg-primary-container/5" : ""
                          }`}
                        >
                          {state === "active" && (
                            <span className="shimmer pointer-events-none absolute inset-0" />
                          )}
                          <span
                            className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm border ${
                              state === "done"
                                ? "border-primary bg-primary-container text-on-primary-container"
                                : state === "active"
                                  ? "live-pulse border-primary bg-primary-container/20 text-primary"
                                  : "border-outline-variant text-outline-variant"
                            }`}
                          >
                            {state === "active" && (
                              <span className="absolute inset-0 rounded-sm border-2 border-transparent border-t-primary spin" />
                            )}
                            <Icon
                              name={state === "done" ? "check" : s.icon}
                              className="text-[18px]"
                            />
                          </span>
                          <span className="relative flex min-w-0 flex-col">
                            <span
                              className={`font-label-caps text-label-caps uppercase ${
                                state === "todo"
                                  ? "text-outline-variant"
                                  : "text-on-surface"
                              }`}
                            >
                              {s.label}
                            </span>
                            {subStatus && (
                              <span className="mt-0.5 truncate font-body-md text-[11px] text-primary/80">
                                {subStatus}…
                              </span>
                            )}
                          </span>
                          {state === "active" && (
                            <span className="relative ml-auto flex items-center gap-xs font-label-caps text-[10px] uppercase text-primary">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary-container live-blink" />
                              Live
                            </span>
                          )}
                          {state === "done" && (
                            <Icon
                              name="check_circle"
                              className="relative ml-auto text-[16px] text-primary"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-lg">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                      <div
                        className="progress-stripes h-full rounded-full bg-primary-container transition-all duration-700"
                        style={{ width: `${Math.max(job.progress, 4)}%` }}
                      />
                    </div>
                    <div className="mt-sm flex items-center justify-between font-label-caps text-[10px] uppercase text-on-surface-variant">
                      <span>{job.progress}% · Generating real footage</span>
                      <span className="flex items-center gap-xs text-primary">
                        <Icon name="schedule" className="text-[14px]" />
                        {mmss(elapsed)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* While you wait — autoplay past broadcasts, advancing on end */}
              {!done && !failed && scCurrent && (
                <div className="mt-lg">
                  <div className="mb-sm flex items-center justify-between">
                    <span className="flex items-center gap-xs font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant">
                      <Icon name="movie" className="text-[12px]" />
                      While you wait — recent broadcasts
                    </span>
                    <span className="font-label-caps text-[10px] uppercase text-outline">
                      {(scIdx % showcase.length) + 1} / {showcase.length}
                    </span>
                  </div>

                  <div className="relative overflow-hidden border border-outline-variant bg-black shadow-2xl">
                    <video
                      ref={scVideoRef}
                      key={scCurrent.id}
                      src={scCurrent.videoUrl ?? undefined}
                      autoPlay
                      muted={scMuted}
                      playsInline
                      onEnded={() => stepShowcase(1)}
                      onError={() => stepShowcase(1)}
                      className="aspect-video w-full object-cover"
                    />

                    {/* Prev / Next controls */}
                    {showcase.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => stepShowcase(-1)}
                          aria-label="Previous broadcast"
                          className="absolute left-sm top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-on-surface opacity-70 backdrop-blur-md transition-all hover:bg-black/80 hover:opacity-100"
                        >
                          <Icon name="chevron_left" className="text-2xl" />
                        </button>
                        <button
                          type="button"
                          onClick={() => stepShowcase(1)}
                          aria-label="Next broadcast"
                          className="absolute right-sm top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-on-surface opacity-70 backdrop-blur-md transition-all hover:bg-black/80 hover:opacity-100"
                        >
                          <Icon name="chevron_right" className="text-2xl" />
                        </button>
                      </>
                    )}

                    {/* Clearly a past clip, not the one being generated */}
                    <div className="pointer-events-none absolute left-sm top-sm flex items-center gap-xs rounded-sm bg-black/70 px-sm py-xs backdrop-blur-md">
                      <Icon name="history" className="text-[12px] text-on-surface" />
                      <span className="font-label-caps text-[9px] uppercase tracking-widest text-on-surface">
                        Past broadcast
                      </span>
                    </div>

                    {/* Mute toggle */}
                    <button
                      type="button"
                      onClick={() => setScMuted((m) => !m)}
                      aria-label={scMuted ? "Unmute" : "Mute"}
                      className="absolute right-sm top-sm flex h-7 w-7 items-center justify-center rounded-sm bg-black/70 text-on-surface backdrop-blur-md transition-colors hover:text-primary"
                    >
                      <Icon name={scMuted ? "volume_off" : "volume_up"} className="text-[16px]" />
                    </button>

                    {/* Caption */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-sm pt-lg">
                      <p className="line-clamp-1 font-headline-lg text-[13px] uppercase leading-tight text-on-surface">
                        {scCurrent.headline ?? hostOf(scCurrent.sourceUrl)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Result */}
              {done && job.videoUrl && (
                <div className="mt-lg">
                  <video
                    src={job.videoUrl}
                    controls
                    autoPlay
                    className="w-full border border-outline-variant bg-black shadow-2xl"
                  />
                  <div className="mt-md flex gap-sm">
                    <a
                      href={job.videoUrl}
                      download
                      className="flex items-center gap-sm bg-primary-container px-lg py-sm font-label-caps text-label-caps uppercase text-on-primary-container transition-all hover:brightness-110"
                    >
                      <Icon name="download" className="text-sm" />
                      Download
                    </a>
                    <Link
                      href="/"
                      className="flex items-center gap-sm border border-outline-variant px-lg py-sm font-label-caps text-label-caps uppercase text-on-surface transition-all hover:bg-surface-container-highest"
                    >
                      <Icon name="add" className="text-sm" />
                      Make Another
                    </Link>
                  </div>

                  {/* Transcript / script from the generated storyboard */}
                  {(job.summary || job.keyPoints.length > 0) && (
                    <div className="glass-panel mt-lg space-y-md p-lg">
                      <span className="font-label-caps text-[10px] uppercase tracking-widest text-primary">
                        Segment Transcript
                      </span>
                      {job.summary && (
                        <p className="font-body-md leading-relaxed text-on-surface-variant">
                          {job.summary}
                        </p>
                      )}
                      {job.keyPoints.length > 0 && (
                        <ul className="space-y-sm border-t border-outline-variant pt-md">
                          {job.keyPoints.map((point, i) => (
                            <li key={i} className="flex gap-md">
                              <span className="mt-0.5 font-label-caps text-primary">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="flex-1 font-body-md text-on-surface">{point}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Failure */}
              {failed && (
                <div className="glass-panel mt-lg flex flex-col items-start gap-md p-lg">
                  <div className="flex items-center gap-sm">
                    <Icon name={errorIcon(job.errorCode)} className="text-3xl text-error" />
                    <p className="font-display-lg text-headline-lg-mobile uppercase text-error">
                      {errorLabel(job.errorCode)}
                    </p>
                  </div>
                  <p className="font-body-md text-on-surface-variant">{job.error}</p>
                  <Link
                    href="/"
                    className="mt-sm flex items-center gap-sm bg-primary-container px-lg py-sm font-label-caps text-label-caps uppercase text-on-primary-container transition-all hover:brightness-110"
                  >
                    <Icon name="arrow_back" className="text-sm" />
                    Try Another Link
                  </Link>
                </div>
              )}
            </>
          )
        )}
      </div>
    </Shell>
  );
}
