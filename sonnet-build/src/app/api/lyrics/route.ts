import { NextResponse } from "next/server";
import { lyrics } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const d = Number(p.get("duration"));
  return NextResponse.json(await lyrics(p.get("title") ?? "", p.get("artist") ?? "", d > 0 ? d : undefined));
}
