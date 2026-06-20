/**
 * Step 10 — POST /api/jobs : create a segment job from a URL.
 * Returns { id } immediately; the pipeline runs in the background (lib/jobs).
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createJob, listJobs, serializeJob } from "@/lib/jobs";
import { isTier } from "@/lib/models";
import { FINAL_ONLY } from "@/lib/flags";
import { FINAL_COOKIE, FINAL_HEADER, checkToken, finalPasswordConfigured } from "@/lib/auth";

/** GET /api/jobs : list jobs (newest first) for the dashboard feed + archive. */
export async function GET() {
  return NextResponse.json({ jobs: listJobs().map(serializeJob) });
}

export async function POST(request: Request) {
  let body: { url?: string; tier?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "missing 'url'" }, { status: 400 });
  }
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    return NextResponse.json({ error: "url must be a valid http(s) link" }, { status: 400 });
  }

  // In final-only mode, force every request to final regardless of input.
  const requested = isTier(body.tier) ? body.tier : null;
  const tier = FINAL_ONLY ? "final" : requested;

  // Final-tier generation requires the access password (when one is configured).
  // Accept the proof from either the httpOnly cookie or the x-rnn-access header
  // (the latter is replayed from the browser's localStorage).
  if (tier === "final" && finalPasswordConfigured()) {
    const jar = await cookies();
    const ok =
      checkToken(jar.get(FINAL_COOKIE)?.value) ||
      checkToken(request.headers.get(FINAL_HEADER));
    if (!ok) {
      return NextResponse.json(
        { error: "Final-tier generation requires the access password." },
        { status: 401 },
      );
    }
  }

  const job = createJob(url, tier);
  return NextResponse.json({ id: job.id, status: job.status }, { status: 201 });
}
