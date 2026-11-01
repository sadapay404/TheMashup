import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { history } from "@/db/schema";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(history).orderBy(desc(history.playedAt)).limit(50);
  return NextResponse.json(rows.map((r) => ({ ...r.track, playedAt: r.playedAt })));
}

export async function POST(req: Request) {
  const track = (await req.json()) as Track;
  await db.insert(history).values({ trackId: track.id, track });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await db.delete(history);
  return NextResponse.json({ ok: true });
}
