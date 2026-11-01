import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { playlists, playlistTracks } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      createdAt: playlists.createdAt,
      count: sql<number>`(select count(*)::int from ${playlistTracks} where ${playlistTracks.playlistId} = ${playlists.id})`,
    })
    .from(playlists)
    .orderBy(desc(playlists.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  const n = name?.trim();
  if (!n) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const [row] = await db.insert(playlists).values({ name: n }).returning();
  return NextResponse.json({ ...row, count: 0 });
}
