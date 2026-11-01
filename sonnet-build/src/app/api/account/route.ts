import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyYouTubeCookie } from "@/lib/sources";

export const dynamic = "force-dynamic";
const NAME = "yt_cookie";

export async function GET() {
  const c = (await cookies()).get(NAME)?.value;
  if (!c) return NextResponse.json({ signedIn: false });
  const v = await verifyYouTubeCookie(c);
  return NextResponse.json({ signedIn: v.ok, name: v.name, error: v.error });
}

export async function POST(req: Request) {
  const { cookie } = (await req.json()) as { cookie?: string };
  if (!cookie?.trim()) return NextResponse.json({ signedIn: false, error: "Paste your YouTube Music cookie first." }, { status: 400 });
  const v = await verifyYouTubeCookie(cookie.trim());
  if (!v.ok) return NextResponse.json({ signedIn: false, error: v.error }, { status: 401 });
  (await cookies()).set(NAME, cookie.trim(), { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 90, path: "/" });
  return NextResponse.json({ signedIn: true, name: v.name });
}

export async function DELETE() {
  (await cookies()).delete(NAME);
  return NextResponse.json({ signedIn: false });
}
