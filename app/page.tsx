"use client";

import { useEffect, useState } from "react";
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

  // Final-tier access gate.
  const [gate, setGate] = useState<{ required: boolean; authorized: boolean }>({
    required: false,
    authorized: true,
  });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

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

          <form onSubmit={handleSubmit} className="mt-xl">
            <div className="glass-panel relative overflow-hidden p-sm shadow-2xl">
              <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
              <div className="flex flex-col gap-sm md:flex-row md:items-center">
                {needsUnlock ? (
                  // Password is the primary input until this browser is unlocked.
                  <>
                    <div className="relative flex-grow">
                      <span className="material-symbols-outlined absolute left-md top-1/2 -translate-y-1/2 text-outline">
                        lock
                      </span>
                      <input
                        type="password"
                        required
                        autoFocus
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="ENTER ACCESS PASSWORD"
                        autoComplete="current-password"
                        className="w-full border-b border-outline bg-surface-container-lowest py-md pl-xl pr-md font-label-caps text-label-caps uppercase tracking-widest text-on-surface outline-none transition-all placeholder:text-on-surface-variant/40 focus:border-primary-container"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={unlocking || !password}
                      className="flex items-center justify-center gap-sm whitespace-nowrap bg-primary-container px-lg py-md font-display-lg text-headline-lg-mobile uppercase text-on-primary-container transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="lock_open" />
                      {unlocking ? "Unlocking…" : "Unlock"}
                    </button>
                  </>
                ) : (
                  // Unlocked (or no gate): the normal generate form.
                  <>
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
                      disabled={submitting}
                      className="flex items-center justify-center gap-sm whitespace-nowrap bg-primary-container px-lg py-md font-display-lg text-headline-lg-mobile uppercase text-on-primary-container transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="bolt" />
                      {submitting ? "Starting…" : "Generate"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Helper line under the password gate */}
            {needsUnlock && (
              <p className="mt-md flex items-center justify-center gap-xs font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant">
                <Icon name="shield" className="text-[12px]" />
                Access-protected — unlock to generate on this browser
              </p>
            )}
            {needsUnlock && gateError && (
              <p className="mt-xs font-label-caps text-[10px] uppercase text-error">{gateError}</p>
            )}

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
              {showGate && gate.authorized && (
                <span className="flex items-center gap-xs rounded-sm border border-tertiary/40 bg-tertiary-container/15 px-sm py-xs text-tertiary">
                  <Icon name="lock_open" className="text-[14px]" />
                  Unlocked
                </span>
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
