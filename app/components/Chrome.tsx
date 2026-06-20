"use client";

import Link from "next/link";
import { RnnLogo } from "../RnnLogo";

/** Material Symbols glyph. */
export function Icon({
  name,
  className = "",
  fill = false,
}: {
  name: string;
  className?: string;
  fill?: boolean;
}) {
  return (
    <span className={`material-symbols-outlined ${fill ? "fill" : ""} ${className}`}>
      {name}
    </span>
  );
}

/**
 * Minimal Runway News Network shell: a slim branded header and the broadcast
 * scanline texture. No nav, metrics, or feeds — just the one thing the app does.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="scanline-overlay" />
      <header className="flex h-16 items-center justify-between border-b border-outline-variant bg-surface/80 px-md backdrop-blur-md md:px-lg">
        <Link href="/" aria-label="Runway News Network home">
          <RnnLogo />
        </Link>
        <div className="flex items-center gap-md">
          <Link
            href="/watch"
            className="flex items-center gap-1.5 font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="smart_display" className="text-[16px]" />
            <span className="hidden sm:inline">Watch</span>
          </Link>
          <span className="flex items-center gap-1.5 font-label-caps text-[10px] uppercase tracking-widest text-primary">
            <span className="live-pulse h-2 w-2 rounded-full bg-primary-container" />
            On Air
          </span>
        </div>
      </header>
      <main className="relative z-10 flex flex-1 flex-col">{children}</main>
    </div>
  );
}
