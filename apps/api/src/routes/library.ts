import { Router } from "express";
import { z } from "zod";
import type { ArtistRef, Track } from "@themashup/shared";
import { ah } from "../middleware/error.js";
import { requireIdentity } from "../middleware/auth.js";
import { libraryDb } from "../services/libraryDb.js";
import { badRequest, notFound } from "../errors.js";

const trackSchema: z.ZodType<Track> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    source: z.enum(["ytdlp", "piped", "invidious", "ytmusic"]),
    external_id: z.string().min(1).max(64),
    title: z.string().min(1).max(300),
    artists: z.array(z.any()),
    artist_names: z.string().max(500),
    album: z.string().max(300).optional(),
    duration_sec: z.number().int().nonnegative().nullable().optional(),
    artwork: z.string().max(2000).nullable().optional(),
    artwork_best: z.string().max(2000).nullable().optional(),
    popularity: z.number().nullable().optional(),
    explicit: z.boolean().optional(),
    category: z.string().optional(),
  }),
) as z.ZodType<Track>;

const artistSchema: z.ZodType<ArtistRef> = z.object({
  name: z.string().min(1).max(200),
  channel_id: z.string().max(128).optional(),
  url: z.string().max(500).optional(),
  image: z.string().max(2000).optional(),
});

function mapNotFound(err: unknown): never {
  const status = (err as { status?: number })?.status;
  if (status === 404) throw notFound((err as Error).message);
  throw err;
}

/** /api/library/* — every route requires an identity (Supabase or demo). */
export function libraryRouter(): Router {
  const r = Router();
  const db = () => libraryDb();

  /* likes */
  r.get(
    "/likes",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      res.json({ likes: await db().listLikes(idd.userId) });
    }),
  );
  r.put(
    "/likes",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const body = z
        .object({ track: trackSchema, kind: z.enum(["up", "down"]).default("up") })
        .parse(req.body);
      await db().setLike(idd.userId, body.track, body.kind);
      res.json({ ok: true });
    }),
  );
  r.delete(
    "/likes/:trackId",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const trackId = z.string().min(1).max(64).parse(req.params.trackId);
      await db().removeLike(idd.userId, trackId);
      res.json({ ok: true });
    }),
  );

  /* history (listening events land here) */
  r.get(
    "/history",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
      res.json({ history: await db().listHistory(idd.userId, limit) });
    }),
  );

  /* playlists */
  r.get(
    "/playlists",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      res.json({ playlists: await db().listPlaylists(idd.userId) });
    }),
  );
  r.post(
    "/playlists",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const body = z
        .object({
          title: z.string().trim().min(1).max(120),
          description: z.string().max(500).optional(),
        })
        .parse(req.body);
      const meta = await db().createPlaylist(idd.userId, body.title, body.description);
      res.status(201).json({ playlist: meta });
    }),
  );
  r.delete(
    "/playlists/:id",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().uuid().parse(req.params.id);
      await db().deletePlaylist(idd.userId, id).catch(mapNotFound);
      res.json({ ok: true });
    }),
  );
  r.get(
    "/playlists/:id",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().uuid().parse(req.params.id);
      const result = await db().getPlaylist(idd.userId, id).catch(mapNotFound);
      res.json(result);
    }),
  );
  r.post(
    "/playlists/:id/tracks",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().uuid().parse(req.params.id);
      const body = z.object({ track: trackSchema }).parse(req.body);
      await db().addToPlaylist(idd.userId, id, body.track).catch(mapNotFound);
      res.json({ ok: true });
    }),
  );
  r.patch(
    "/playlists/:id/tracks/order",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().uuid().parse(req.params.id);
      const body = z
        .object({ track_ids: z.array(z.string().min(1).max(64)).min(1).max(500) })
        .parse(req.body);
      const current = await db().getPlaylist(idd.userId, id).catch(mapNotFound);
      const ids = body.track_ids;
      const ok =
        new Set(ids).size === ids.length &&
        ids.length === current.tracks.length &&
        ids.every((t) => current.tracks.some((x) => x.id === t));
      if (!ok) throw badRequest("track_ids must be a permutation of the playlist");
      await db().reorderPlaylist(idd.userId, id, ids);
      res.json(await db().getPlaylist(idd.userId, id).catch(mapNotFound));
    }),
  );
  r.delete(
    "/playlists/:id/tracks/:trackId",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().uuid().parse(req.params.id);
      const trackId = z.string().min(1).max(64).parse(req.params.trackId);
      await db().removeFromPlaylist(idd.userId, id, trackId).catch(mapNotFound);
      res.json({ ok: true });
    }),
  );

  /* artist follows */
  r.get(
    "/follows",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      res.json({ follows: await db().listFollows(idd.userId) });
    }),
  );
  r.put(
    "/follows",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const body = z.object({ artist: artistSchema }).parse(req.body);
      await db().follow(idd.userId, body.artist);
      res.json({ ok: true });
    }),
  );
  r.delete(
    "/follows/:artistKey",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const key = decodeURIComponent(z.string().min(1).max(200).parse(req.params.artistKey));
      await db().unfollow(idd.userId, key);
      res.json({ ok: true });
    }),
  );

  return r;
}
