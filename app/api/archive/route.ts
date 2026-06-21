/**
 * GET /api/archive : past broadcasts from the DB (newest first).
 * Backs the "while you wait" showcase on the segment page. Returns [] if
 * Supabase isn't configured.
 */
import { NextResponse } from "next/server";
import { listJobsFromDb, dbEnabled } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbEnabled()) return NextResponse.json({ jobs: [] });
  return NextResponse.json({ jobs: await listJobsFromDb() });
}
