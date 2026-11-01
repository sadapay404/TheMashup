import { NextResponse } from "next/server";
import { related } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const id = p.get("id") ?? "";
  const artist = p.get("artist") ?? "";
  const title = p.get("title") ?? "";
  if (!artist) return NextResponse.json([]);
  return NextResponse.json(await related({ id, artist, title }));
}
