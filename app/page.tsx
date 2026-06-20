"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell, Icon } from "./components/Chrome";
import { FINAL_ONLY } from "@/lib/flags";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState<"draft" | "final">(FINAL_ONLY ? "final" : "draft");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Final-tier access gate.
  const [gate, setGate] = useState<{ required: boolean; authorized: boolean }>({
    required: false,
    authorized: true,
  });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setGate({ required: !!d.required, authorized: !!d.authorized }))
      .catch(() => {});
  }, []);

  const effectiveTier = FINAL_ONLY ? "final" : tier;
  const needsUnlock = effectiveTier === "final" && gate.required && !gate.authorized;
  const showGate = effectiveTier === "final" && gate.required;

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
      setGate((g) => ({ ...g, authorized: true }));
      setPassword("");
    } catch (err) {
      setGateError((err as Error).message);
    } finally {
      setUnlocking(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (needsUnlock) {
      setGateError("Enter the access password to generate.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
            Get a <span className="text-primary-container">30-second</span> broadcast.
          </h1>

          <p className="mx-auto mt-md max-w-[32rem] font-body-md text-on-surface-variant">
            RNN reads the story, writes the segment, and produces an AI-anchored
            news clip — opener, anchor, B-roll, and chyrons included.
          </p>

          <form onSubmit={submit} className="mt-xl">
            <div className="glass-panel relative overflow-hidden p-sm shadow-2xl">
              <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
              <div className="flex flex-col gap-sm md:flex-row md:items-center">
                <div className="relative flex-grow">
                  <span className="material-symbols-outlined absolute left-md top-1/2 -translate-y-1/2 text-outline">
                    link
                  </span>
                  <input
                    type="url"
                    required
                    autoFocus
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/news/story"
                    className="w-full border-b border-outline bg-surface-container-lowest py-md pl-xl pr-md font-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/40 focus:border-primary-container"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || needsUnlock}
                  title={needsUnlock ? "Enter the access password to generate" : undefined}
                  className="flex items-center justify-center gap-sm whitespace-nowrap bg-primary-container px-lg py-md font-display-lg text-headline-lg-mobile uppercase text-on-primary-container transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name={needsUnlock ? "lock" : "bolt"} />
                  {submitting ? "Starting…" : "Generate"}
                </button>
              </div>
            </div>

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

            {/* Final-tier access gate */}
            {showGate &&
              (gate.authorized ? (
                <div className="mx-auto mt-md inline-flex items-center gap-xs rounded-sm border border-tertiary/40 bg-tertiary-container/15 px-sm py-xs font-label-caps text-[10px] uppercase tracking-widest text-tertiary">
                  <Icon name="lock_open" className="text-[14px]" />
                  Final access unlocked
                </div>
              ) : (
                <div className="mx-auto mt-md w-full max-w-[26rem]">
                  <div className="glass-panel flex items-center gap-sm p-xs">
                    <Icon name="lock" className="ml-sm text-outline" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          unlock();
                        }
                      }}
                      placeholder="ACCESS PASSWORD"
                      autoComplete="current-password"
                      className="w-full flex-grow bg-transparent py-sm font-label-caps text-label-caps uppercase tracking-widest text-on-surface outline-none placeholder:text-on-surface-variant/40"
                    />
                    <button
                      type="button"
                      onClick={unlock}
                      disabled={unlocking || !password}
                      className="flex items-center gap-xs whitespace-nowrap bg-primary-container px-md py-sm font-label-caps text-label-caps uppercase text-on-primary-container transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {unlocking ? "…" : "Unlock"}
                    </button>
                  </div>
                  <p className="mt-xs flex items-center justify-center gap-xs font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant">
                    <Icon name="shield" className="text-[12px]" />
                    Final-tier generation is access-protected
                  </p>
                  {gateError && (
                    <p className="mt-xs font-label-caps text-[10px] uppercase text-error">
                      {gateError}
                    </p>
                  )}
                </div>
              ))}

            {error && (
              <p className="mt-md font-label-caps text-[11px] uppercase text-error">{error}</p>
            )}
          </form>
        </div>
      </div>
    </Shell>
  );
}
