"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "../components/Chrome";
import { hostOf, formatDate } from "../lib/jobView";

export interface WatchItem {
  id: string;
  headline: string | null;
  sourceUrl: string;
  videoUrl: string;
  tier: string | null;
  createdAt: number;
}

/**
 * Full-screen broadcast viewer: one segment fills the stage, with left/right
 * controls (and arrow keys) to move through the available videos.
 */
export function WatchDeck({ items, startIndex = 0 }: { items: WatchItem[]; startIndex?: number }) {
  const [i, setI] = useState(Math.min(Math.max(startIndex, 0), items.length - 1));

  const atStart = i <= 0;
  const atEnd = i >= items.length - 1;

  const go = useCallback(
    (dir: -1 | 1) => setI((x) => Math.min(Math.max(x + dir, 0), items.length - 1)),
    [items.length],
  );

  // Arrow-key navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const current = items[i];

  return (
    <div className="relative flex h-[calc(100vh-4rem)] flex-col bg-black">
      {/* Stage — the inner box tracks the 16:9 video so the arrows sit right at
          the video's edges rather than the far edges of the viewport. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-sm">
        <div className="relative flex aspect-video max-h-full max-w-full items-center justify-center">
          <video
            key={current.id}
            src={current.videoUrl}
            controls
            autoPlay
            onEnded={() => go(1)}
            className="h-full w-full"
          />

          {/* Prev / Next — hugging the video edges */}
          <NavArrow side="left" disabled={atStart} onClick={() => go(-1)} />
          <NavArrow side="right" disabled={atEnd} onClick={() => go(1)} />

          {/* Counter */}
          <div className="pointer-events-none absolute right-sm top-sm flex items-center gap-xs rounded-sm bg-black/60 px-sm py-xs font-label-caps text-[10px] uppercase tracking-widest text-on-surface backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-container live-pulse" />
            {i + 1} / {items.length}
          </div>
        </div>
      </div>

      {/* Metadata bar */}
      <div className="border-t border-outline-variant bg-surface px-md py-md md:px-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-xs flex items-center gap-sm font-label-caps text-[10px] uppercase text-on-surface-variant">
              <Icon name="language" className="text-[14px]" />
              <span className="truncate">
                {hostOf(current.sourceUrl)} • {formatDate(current.createdAt)}
              </span>
              <span className="rounded bg-tertiary-container/30 px-sm py-0.5 text-on-tertiary-container">
                {current.tier === "final" ? "Final" : "Draft"}
              </span>
            </div>
            <h1 className="truncate font-display-lg text-headline-lg-mobile uppercase text-on-surface">
              {current.headline ?? hostOf(current.sourceUrl)}
            </h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-sm">
            <a
              href={current.videoUrl}
              download
              className="flex items-center gap-sm border border-outline-variant px-md py-sm font-label-caps text-label-caps uppercase text-on-surface transition-all hover:bg-surface-container-highest"
            >
              <Icon name="download" className="text-sm" />
              <span className="hidden sm:inline">Download</span>
            </a>
            <Link
              href={`/segment/${current.id}`}
              className="flex items-center gap-sm bg-primary-container px-md py-sm font-label-caps text-label-caps uppercase text-on-primary-container transition-all hover:brightness-110"
            >
              <Icon name="article" className="text-sm" />
              <span className="hidden sm:inline">Details</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous broadcast" : "Next broadcast"}
      className={`absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 backdrop-blur-md transition-all ${
        side === "left" ? "left-sm" : "right-sm"
      } ${disabled ? "pointer-events-none opacity-0" : "opacity-70 hover:bg-black/80 hover:opacity-100"}`}
    >
      <Icon
        name={side === "left" ? "chevron_left" : "chevron_right"}
        className="text-3xl text-on-surface"
      />
    </button>
  );
}
