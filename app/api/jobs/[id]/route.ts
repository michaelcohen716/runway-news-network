/**
 * GET /api/jobs/:id : poll a job's status.
 * Resolves from the live in-memory store, falling back to the DB so completed
 * segments survive a server restart. (Next 16: route `params` is async.)
 */
import { NextResponse } from "next/server";
import { getJobView } from "@/lib/jobs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const view = await getJobView(id);
  if (!view) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  return NextResponse.json(view);
}
