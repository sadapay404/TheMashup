import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { playlists, playlistTracks } from "@/db/schema";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const [pl] = await db.select().from(playlists).where(eq(playlists.id, id));
  if (!pl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(playlistTracks).where(eq(playlistTracks.playlistId, id)).orderBy(asc(playlistTracks.id));
  return NextResponse.json({ ...pl, tracks: rows.map((r) => r.track) });
}

/** Rename */
export async function PATCH(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  await db.update(playlists).set({ name: name.trim() }).where(eq(playlists.id, id));
  return NextResponse.json({ ok: true });
}

/** Add a track */
export async function POST(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const track = (await req.json()) as Track;
  const dup = await db
    .select({ id: playlistTracks.id })
    .from(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, id), eq(playlistTracks.trackId, track.id)));
  if (!dup.length) await db.insert(playlistTracks).values({ playlistId: id, trackId: track.id, track });
  return NextResponse.json({ ok: true, duplicate: dup.length > 0 });
}

/** Delete playlist, or remove one track with ?trackId= */
export async function DELETE(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const trackId = new URL(req.url).searchParams.get("trackId");
  if (trackId) {
    await db.delete(playlistTracks).where(and(eq(playlistTracks.playlistId, id), eq(playlistTracks.trackId, trackId)));
  } else {
    await db.delete(playlists).where(eq(playlists.id, id));
  }
  return NextResponse.json({ ok: true });
}
