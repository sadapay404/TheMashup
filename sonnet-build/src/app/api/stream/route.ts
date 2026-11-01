import { NextResponse } from "next/server";
import { resolveStream } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const r = await resolveStream({
    id: p.get("id") ?? "",
    title: p.get("title") ?? "",
    artist: p.get("artist") ?? "",
    previewUrl: p.get("preview") ?? undefined,
  });
  if (!r) return NextResponse.json({ error: "No playable source found for this track." }, { status: 404 });
  return NextResponse.json(r);
}
