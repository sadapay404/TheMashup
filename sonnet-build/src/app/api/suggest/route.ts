import { NextResponse } from "next/server";
import { suggest } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json([]);
  return NextResponse.json(await suggest(q));
}
