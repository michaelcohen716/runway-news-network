/**
 * Final-tier access gate API.
 *   GET  /api/auth  → { required, authorized }  (does the gate apply, am I in?)
 *   POST /api/auth  { password } → sets an httpOnly proof cookie on success.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  FINAL_COOKIE,
  accessToken,
  checkPassword,
  checkToken,
  finalPasswordConfigured,
} from "@/lib/auth";

export async function GET() {
  const jar = await cookies();
  return NextResponse.json({
    required: finalPasswordConfigured(),
    authorized: checkToken(jar.get(FINAL_COOKIE)?.value),
  });
}

export async function POST(request: Request) {
  let password = "";
  try {
    ({ password = "" } = await request.json());
  } catch {
    /* treat as empty */
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Incorrect access password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(FINAL_COOKIE, accessToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
