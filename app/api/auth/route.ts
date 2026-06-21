/**
 * Final-tier access gate API.
 *   GET  /api/auth  → { required, authorized }  (cookie or x-rnn-access header)
 *   POST /api/auth  { password } → { ok, token }  + sets an httpOnly cookie.
 *
 * The returned `token` is a one-way proof the browser persists in localStorage
 * and replays via the x-rnn-access header; the cookie is also set as a fallback.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  FINAL_COOKIE,
  FINAL_HEADER,
  accessToken,
  checkPassword,
  checkToken,
  finalPasswordConfigured,
} from "@/lib/auth";

export async function GET(request: Request) {
  const jar = await cookies();
  const fromCookie = jar.get(FINAL_COOKIE)?.value;
  const fromHeader = request.headers.get(FINAL_HEADER);
  return NextResponse.json({
    required: finalPasswordConfigured(),
    authorized: checkToken(fromCookie) || checkToken(fromHeader),
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

  const token = accessToken();
  const res = NextResponse.json({ ok: true, token });
  res.cookies.set(FINAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

/** Lock this browser again: clear the access cookie. (Clients also clear their
 *  localStorage token.) */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(FINAL_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
