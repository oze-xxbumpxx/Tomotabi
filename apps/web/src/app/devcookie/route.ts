import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";

// TEMPORARY testing route: sets the session cookie read from /tmp/token.txt.
// Not to be committed.
export async function GET() {
  const raw = readFileSync("/tmp/token.txt", "utf8").trim();
  const sep = raw.indexOf("=");
  const name = raw.slice(0, sep);
  const value = raw.slice(sep + 1);
  const res = NextResponse.redirect(new URL("/trips", "http://localhost:3000"));
  res.cookies.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
