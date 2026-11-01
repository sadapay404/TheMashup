import { NextResponse } from "next/server";
import { search } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  const filter = u.searchParams.get("filter") ?? "all";
  if (!q) return NextResponse.json({ songs: [], artists: [], albums: [], lyrics: [], via: [] });
  return NextResponse.json(await search(q, filter));
}
