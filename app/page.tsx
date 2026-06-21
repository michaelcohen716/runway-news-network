"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell, Icon } from "./components/Chrome";
import { FINAL_ONLY } from "@/lib/flags";

/** localStorage key holding the final-tier access proof for this browser. */
const TOKEN_KEY = "rnn_final_token";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState<"draft" | "final">(FINAL_ONLY ? "final" : "draft");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Final-tier access gate. Start "locked" when prod is final-only so the first
  // paint shows the unlock view (no flash); the auth check then reveals generate.
  const [gate, setGate] = useState<{ required: boolean; authorized: boolean }>({
    required: FINAL_ONLY,
    authorized: false,
  });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const urlRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  // On load, validate any persisted token so this browser stays unlocked.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    fetch("/api/auth", { headers: token ? { "x-rnn-access": token } : {} })
      .then((r) => r.json())
      .then((d) => {
        setGate({ required: !!d.required, authorized: !!d.authorized });
        if (token && !d.authorized) localStorage.removeItem(TOKEN_KEY); // stale
      })
      .catch(() => {});
  }, []);

  const effectiveTier = FINAL_ONLY ? "final" : tier;
  const showGate = effectiveTier === "final" && gate.required;
  const needsUnlock = showGate && !gate.authorized;
  const view: "lock" | "gen" = needsUnlock ? "lock" : "gen";

  // Move focus to whichever input just became active.
  useEffect(() => {
    const t = setTimeout(() => {
      if (view === "lock") pwRef.current?.focus();
      else urlRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [view]);

  async function unlock() {
    if (!password) return;
    setGateError(null);
    setUnlocking(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Incorrect password");
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      setGate((g) => ({ ...g, authorized: true }));
      setPassword("");
    } catch (err) {
      setGateError((err as Error).message);
    } finally {
      setUnlocking(false);
    }
  }

  async function generate() {
    setError(null);
    setSubmitting(true);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-rnn-access": token } : {}),
        },
        body: JSON.stringify({ url, tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to start");
      router.push(`/segment/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  // One form; Enter / primary button routes to unlock or generate by state.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (needsUnlock) unlock();
    else generate();
  }

  // Shared classes for the two crossfading rows (stacked in one grid cell).
  // Opacity-only crossfade with a soft easing — no transforms or layout changes,
  // so the swap reads as a clean dissolve with zero hop.
  const rowBase =
    "col-start-1 row-start-1 flex flex-col gap-sm transition-opacity duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] md:flex-row md:items-center";
  const inputBase =
    "w-full border-b border-outline bg-surface-container-lowest py-md pl-xl pr-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/40 focus:border-primary-container disabled:opacity-100";
  const buttonBase =
    "flex items-center justify-center gap-sm whitespace-nowrap bg-primary-container px-lg py-md font-display-lg text-headline-lg-mobile uppercase text-on-primary-container transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center px-md py-xl text-center">
        <div className="w-full max-w-2xl">
          <span className="inline-flex items-center gap-sm rounded-full border border-outline-variant bg-surface-container-high px-md py-xs font-label-caps text-[10px] uppercase tracking-widest text-primary">
            <span className="live-pulse h-2 w-2 rounded-full bg-primary-container" />
            AI Newsroom
          </span>

          <h1 className="mt-lg font-display-lg text-headline-lg leading-tight tracking-tight text-on-surface lg:text-[56px]">
            Paste a news link.
            <br />
            Generate a <span className="text-primary-container">broadcast</span> news segment.
          </h1>

          <p className="mx-auto mt-md max-w-[32rem] font-body-md text-on-surface-variant">
            RNN reads the story, writes the segment, and produces an AI-anchored
            news clip — opener, anchor, B-roll, and chyrons included.
          </p>

          <form onSubmit={handleSubmit} className="mt-xl">
            <div className="glass-panel relative overflow-hidden p-sm shadow-2xl">
              <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />

              {/* Both rows occupy the same grid cell and crossfade between states. */}
              <div className="grid">
                {/* Unlock row */}
                <div
                  aria-hidden={view !== "lock"}
                  className={`${rowBase} ${
                    view === "lock" ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                >
                  <div className="relative flex-grow">
                    <span className="material-symbols-outlined absolute left-md top-1/2 -translate-y-1/2 text-outline">
                      lock
                    </span>
                    <input
                      ref={pwRef}
                      type="password"
                      disabled={view !== "lock"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="ENTER ACCESS PASSWORD"
                      autoComplete="current-password"
                      className={`${inputBase} font-label-caps text-label-caps uppercase tracking-widest`}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={unlocking || !password || view !== "lock"}
                    className={buttonBase}
                  >
                    <Icon name="lock_open" />
                    {unlocking ? "Unlocking…" : "Unlock"}
                  </button>
                </div>

                {/* Generate row */}
                <div
                  aria-hidden={view !== "gen"}
                  className={`${rowBase} ${
                    view === "gen" ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                >
                  <div className="relative flex-grow">
                    <span className="material-symbols-outlined absolute left-md top-1/2 -translate-y-1/2 text-outline">
                      link
                    </span>
                    <input
                      ref={urlRef}
                      type="url"
                      required
                      disabled={view !== "gen"}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com/news/story"
                      className={`${inputBase} font-body-md`}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || view !== "gen"}
                    className={buttonBase}
                  >
                    <Icon name="bolt" />
                    {submitting ? "Starting…" : "Generate"}
                  </button>
                </div>
              </div>
            </div>

            {/* Gate helper / error — constant-height slot, fades only (no reflow) */}
            <div className="mt-md h-8">
              <div
                className={`transition-opacity duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                  view === "lock" ? "opacity-100" : "opacity-0"
                }`}
              >
                <p
                  className={`flex items-center justify-center gap-xs font-label-caps text-[10px] uppercase tracking-widest ${
                    gateError ? "text-error" : "text-on-surface-variant"
                  }`}
                >
                  <Icon name={gateError ? "error" : "shield"} className="text-[12px]" />
                  {gateError ?? "Access-protected — unlock to generate on this browser"}
                </p>
              </div>
            </div>

            {/* Quality selector (and unlocked indicator) */}
            <div className="mt-md flex items-center justify-center gap-sm font-label-caps text-[11px] uppercase">
              <span className="text-on-surface-variant">Quality</span>
              {FINAL_ONLY ? (
                <span className="flex items-center gap-xs rounded-sm border border-primary bg-primary-container/20 px-sm py-xs text-primary">
                  <Icon name="hd" className="text-[14px]" />
                  Final · Full Video
                </span>
              ) : (
                (["draft", "final"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    className={`rounded-sm border px-sm py-xs transition-all ${
                      tier === t
                        ? "border-primary bg-primary-container/20 text-primary"
                        : "border-outline-variant text-on-surface-variant hover:border-outline"
                    }`}
                  >
                    {t === "draft" ? "Draft · Fast" : "Final · Full Video"}
                  </button>
                ))
              )}
            </div>

            {error && (
              <p className="mt-md font-label-caps text-[11px] uppercase text-error">{error}</p>
            )}
          </form>
        </div>
      </div>
    </Shell>
  );
}
