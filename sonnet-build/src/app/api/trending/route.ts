import { NextResponse } from "next/server";
import { trending } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await trending());
}
