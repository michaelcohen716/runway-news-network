/** The Runway News Network lockup: red "RNN" badge + wordmark, with a live dot. */
export function RnnLogo({ size = "md" }: { size?: "sm" | "md" }) {
  const badge =
    size === "sm" ? "text-lg px-1.5 py-0.5" : "text-2xl px-2.5 py-0.5";
  const word = size === "sm" ? "text-xs" : "text-sm";
  return (
    <div className="flex items-center gap-3">
      <span
        className={`font-display-lg font-bold tracking-tight bg-primary-container text-on-primary-container ${badge}`}
      >
        RNN
      </span>
      <span
        className={`hidden font-display-lg font-bold uppercase tracking-[0.2em] text-on-surface sm:inline ${word}`}
      >
        Runway News Network
      </span>
    </div>
  );
}
