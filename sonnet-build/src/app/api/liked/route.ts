import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { likedTracks } from "@/db/schema";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(likedTracks).orderBy(desc(likedTracks.likedAt));
  return NextResponse.json(rows.map((r) => r.track));
}

/** Toggle like. Returns { liked } */
export async function POST(req: Request) {
  const track = (await req.json()) as Track;
  const existing = await db.select().from(likedTracks).where(eq(likedTracks.trackId, track.id));
  if (existing.length) {
    await db.delete(likedTracks).where(eq(likedTracks.trackId, track.id));
    return NextResponse.json({ liked: false });
  }
  await db.insert(likedTracks).values({ trackId: track.id, track });
  return NextResponse.json({ liked: true });
}
