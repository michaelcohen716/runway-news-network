import Link from "next/link";
import { Shell, Icon } from "../components/Chrome";
import { WatchDeck, type WatchItem } from "./WatchDeck";
import { listJobsFromDb, dbEnabled } from "@/lib/db";
import { FINAL_ONLY } from "@/lib/flags";

// Always read fresh from the DB.
export const dynamic = "force-dynamic";

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const jobs = dbEnabled() ? await listJobsFromDb() : [];

  // Only watchable items: completed with a playable video. In final-only mode,
  // draft segments aren't viewable.
  const items: WatchItem[] = jobs
    .filter((j) => j.status === "completed" && j.videoUrl && (!FINAL_ONLY || j.tier === "final"))
    .map((j) => ({
      id: j.id,
      headline: j.headline,
      sourceUrl: j.sourceUrl,
      videoUrl: j.videoUrl as string,
      tier: j.tier,
      createdAt: j.createdAt,
    }));

  if (items.length === 0) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-md px-md py-xl text-center">
          <Icon name="smart_display" className="text-6xl text-outline" />
          <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            {dbEnabled()
              ? "No broadcasts to watch yet."
              : "Supabase isn’t configured — nothing to watch."}
          </p>
          <Link
            href="/"
            className="bg-primary-container px-lg py-sm font-label-caps text-label-caps uppercase text-on-primary-container transition-all hover:brightness-110"
          >
            Generate a Broadcast
          </Link>
        </div>
      </Shell>
    );
  }

  const startIndex = Math.max(
    0,
    items.findIndex((it) => it.id === v),
  );

  return (
    <Shell>
      <WatchDeck items={items} startIndex={startIndex} />
    </Shell>
  );
}
