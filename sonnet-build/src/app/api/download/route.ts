import { resolveStream } from "@/lib/sources";

export const dynamic = "force-dynamic";

/** Streams the resolved audio/video through the server (with Range support) so the client can show progress & resume. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const quality = p.get("quality") ?? "192";
  const video = quality === "mp4";
  const r = await resolveStream(
    { id: p.get("id") ?? "", title: p.get("title") ?? "", artist: p.get("artist") ?? "", previewUrl: p.get("preview") ?? undefined },
    { bitrate: video ? undefined : Number(quality) || 192, video },
  );
  if (!r) {
    return Response.json(
      { error: video ? "Video is not available from the current mirrors." : "No downloadable source found." },
      { status: 422 },
    );
  }
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0" };
  const range = req.headers.get("range");
  if (range) headers.range = range;
  const up = await fetch(r.url, { headers, cache: "no-store" });
  if (!up.ok && up.status !== 206) return Response.json({ error: `Upstream HTTP ${up.status}` }, { status: 502 });
  const out = new Headers();
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = up.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("content-type", r.mime ?? up.headers.get("content-type") ?? "application/octet-stream");
  out.set("x-stream-kind", r.kind);
  out.set("cache-control", "no-store");
  return new Response(up.body, { status: up.status, headers: out });
}
