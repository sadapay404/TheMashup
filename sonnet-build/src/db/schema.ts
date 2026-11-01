import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { Track } from "@/lib/types";

export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const playlistTracks = pgTable("playlist_tracks", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id")
    .notNull()
    .references(() => playlists.id, { onDelete: "cascade" }),
  trackId: text("track_id").notNull(),
  track: jsonb("track").$type<Track>().notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const likedTracks = pgTable("liked_tracks", {
  trackId: text("track_id").primaryKey(),
  track: jsonb("track").$type<Track>().notNull(),
  likedAt: timestamp("liked_at").defaultNow().notNull(),
});

export const history = pgTable("history", {
  id: serial("id").primaryKey(),
  trackId: text("track_id").notNull(),
  track: jsonb("track").$type<Track>().notNull(),
  playedAt: timestamp("played_at").defaultNow().notNull(),
});
