"use client";
import { useEffect, useRef, useState } from "react";
import type { LyricsResponse, Track } from "@/lib/types";
import { fmtTime } from "@/lib/format";
import { api } from "@/lib/api";
import { Artwork, Icon, IconButton } from "./ui";
import { useApp } from "./app-context";
import { usePlayer } from "./player-context";

export function Transport({ big }: { big?: boolean }) {
  const { state, toggle, next, prev } = usePlayer();
  const { settings, update } = useApp();
  const playing = state === "playing";
  const busy = state === "loading";
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-3">
      <IconButton icon="shuffle" label="Shuffle" active={settings.shuffle} onClick={() => update({ shuffle: !settings.shuffle })} />
      <IconButton icon="prev" label="Previous" size={big ? 30 : 24} onClick={prev} className="text-text" />
      <button
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={`grid shrink-0 place-items-center rounded-full bg-accent text-accent-ink shadow-lg transition hover:scale-105 ${big ? "h-16 w-16" : "h-12 w-12"}`}
      >
        {busy ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" /> : <Icon name={playing ? "pause" : "play"} size={big ? 34 : 28} />}
      </button>
      <IconButton icon="next" label="Next" size={big ? 30 : 24} onClick={next} className="text-text" />
      <div className="relative">
        <IconButton
          icon="repeat"
          label={`Repeat: ${settings.repeat}`}
          active={settings.repeat !== "off"}
          onClick={() => update({ repeat: settings.repeat === "off" ? "all" : settings.repeat === "all" ? "one" : "off" })}
        />
        {settings.repeat === "one" && <span className="pointer-events-none absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-ink">1</span>}
      </div>
    </div>
  );
}

export function SeekBar() {
  const { position, duration, seek, current } = usePlayer();
  const [drag, setDrag] = useState<number | null>(null);
  const dur = duration || current?.duration || 0;
  const val = drag ?? position;
  return (
    <div className="flex w-full items-center gap-3 text-xs tabular-nums text-muted">
      <span className="w-10 text-right">{fmtTime(val)}</span>
      <input
        type="range"
        min={0}
        max={dur || 1}
        step={0.5}
        value={Math.min(val, dur || 1)}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        disabled={!dur}
        aria-label="Seek"
        className="h-1.5 flex-1 accent-[var(--accent)]"
      />
      <span className="w-10">{fmtTime(dur)}</span>
    </div>
  );
}

export function MiniPlayer() {
  const { current, state, toggle, next, setExpanded, setQueueOpen, error } = usePlayer();
  const { likedIds, toggleLike } = useApp();
  const { position, duration } = usePlayer();
  if (!current) return null;
  const dur = duration || current.duration || 0;
  const pct = dur ? (position / dur) * 100 : 0;
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 px-2 md:bottom-3 md:left-64 md:px-4">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-outline bg-raised/85 shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-outline"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
        <div className="flex items-center gap-3 p-2.5">
          <button onClick={() => setExpanded(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Open player">
            <Artwork src={current.artwork} size={46} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{current.title}</p>
              <p className={`truncate text-xs ${state === "error" ? "text-red-400" : "text-muted"}`}>{state === "error" ? error : state === "loading" ? "Loading…" : current.artist}</p>
            </div>
          </button>
          <IconButton icon="heart" label="Like" active={likedIds.has(current.id)} outline={!likedIds.has(current.id)} size={20} onClick={() => void toggleLike(current)} className="hidden sm:inline-flex" />
          <IconButton icon="queue" label="Queue" size={20} onClick={() => setQueueOpen(true)} />
          <button onClick={toggle} aria-label={state === "playing" ? "Pause" : "Play"} className="grid h-11 w-11 place-items-center rounded-full bg-accent text-accent-ink">
            {state === "loading" ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" /> : <Icon name={state === "playing" ? "pause" : "play"} />}
          </button>
          <IconButton icon="next" label="Next" onClick={next} className="text-text" />
        </div>
      </div>
    </div>
  );
}

function Lyrics({ track }: { track: Track }) {
  const { position } = usePlayer();
  const [data, setData] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setData(null);
    const qs = new URLSearchParams({ title: track.title, artist: track.artist });
    if (track.duration) qs.set("duration", String(track.duration));
    api<LyricsResponse>(`/api/lyrics?${qs}`)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData({ synced: [], plain: "" }))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [track.id, track.title, track.artist, track.duration]);

  let cur = -1;
  if (data?.synced.length) {
    for (let i = 0; i < data.synced.length; i++) if (data.synced[i].t <= position + 0.25) cur = i;
  }
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${cur}"]`);
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [cur]);

  if (loading) return <p className="p-6 text-center text-sm text-muted">Looking for lyrics…</p>;
  if (data?.synced.length)
    return (
      <div ref={box} className="relative h-full space-y-3 overflow-y-auto px-2 py-[30%] text-center">
        {data.synced.map((l, i) => (
          <p key={i} data-line={i} className={`text-xl font-bold leading-snug transition-all sm:text-2xl ${i === cur ? "scale-105 text-accent" : i < cur ? "text-subtle" : "text-muted"}`}>
            {l.text || "♪"}
          </p>
        ))}
      </div>
    );
  if (data?.plain) return <div className="h-full overflow-y-auto whitespace-pre-wrap px-2 py-4 text-center text-base leading-relaxed text-muted">{data.plain}</div>;
  return <p className="p-6 text-center text-sm text-muted">No lyrics found for this track.</p>;
}

export function ExpandedPlayer() {
  const { current, expanded, setExpanded, setQueueOpen, note, error, state } = usePlayer();
  const { settings, update, likedIds, toggleLike, pickPlaylist } = useApp();
  const [tab, setTab] = useState<"art" | "lyrics">("art");
  if (!expanded || !current) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg" style={{ backgroundImage: "var(--backdrop)" }}>
      {current.artwork && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current.artwork} alt="" className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-20 blur-3xl" />
      )}
      <div className="relative flex items-center justify-between p-3 sm:p-5">
        <IconButton icon="down" label="Collapse" size={28} onClick={() => setExpanded(false)} />
        <div className="flex rounded-full border border-outline bg-surface/70 p-1 text-sm font-semibold backdrop-blur">
          {(["art", "lyrics"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1 capitalize ${tab === t ? "bg-accent text-accent-ink" : "text-muted"}`}>
              {t === "art" ? "Now playing" : "Lyrics"}
            </button>
          ))}
        </div>
        <IconButton icon="queue" label="Queue" size={24} onClick={() => setQueueOpen(true)} />
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 px-6 pb-6 lg:flex-row lg:items-center lg:gap-12">
        <div className={`flex min-h-0 flex-1 items-center justify-center ${tab === "lyrics" ? "hidden lg:flex" : "flex"}`}>
          <Artwork src={current.artwork} className="aspect-square w-full max-w-sm shadow-2xl sm:max-w-md" rounded="rounded-3xl" />
        </div>
        <div className={`min-h-0 flex-1 lg:h-[60vh] ${tab === "art" ? "hidden lg:block" : "block"}`}>
          <div className="h-full rounded-3xl border border-outline bg-surface/60 p-3 backdrop-blur-xl">
            <Lyrics track={current} />
          </div>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-2xl space-y-4 px-6 pb-8">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-extrabold tracking-tight">{current.title}</h2>
            <p className="truncate text-muted">{current.artist}{current.album ? ` · ${current.album}` : ""}</p>
          </div>
          <IconButton icon="plus" label="Add to playlist" onClick={() => pickPlaylist(current)} />
          <IconButton icon="heart" label="Like" active={likedIds.has(current.id)} outline={!likedIds.has(current.id)} onClick={() => void toggleLike(current)} />
        </div>
        {(note || (state === "error" && error)) && (
          <p className={`rounded-xl px-3 py-2 text-xs ${state === "error" ? "bg-red-500/15 text-red-300" : "bg-raised text-muted"}`}>{state === "error" ? error : note}</p>
        )}
        <SeekBar />
        <Transport big />
        <div className="flex items-center gap-3 text-muted">
          <Icon name="vol" size={20} />
          <input type="range" min={0} max={1} step={0.01} value={settings.volume} onChange={(e) => update({ volume: Number(e.target.value) })} aria-label="Volume" className="flex-1 accent-[var(--accent)]" />
          <select value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })} aria-label="Speed" className="rounded-lg border border-outline bg-raised px-2 py-1 text-xs text-text">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function QueueDrawer() {
  const { queue, index, queueOpen, setQueueOpen, jumpTo, removeFromQueue, moveInQueue, clearQueue, current, addToQueue } = usePlayer();
  const [rel, setRel] = useState<Track[]>([]);
  useEffect(() => {
    if (!queueOpen || !current) return;
    let dead = false;
    api<Track[]>(`/api/related?${new URLSearchParams({ id: current.id, artist: current.artist, title: current.title })}`)
      .then((r) => !dead && setRel(r))
      .catch(() => !dead && setRel([]));
    return () => {
      dead = true;
    };
  }, [queueOpen, current]);

  return (
    <>
      <div onClick={() => setQueueOpen(false)} className={`fixed inset-0 z-[60] bg-black/50 transition-opacity ${queueOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <aside className={`fixed inset-y-0 right-0 z-[61] flex w-full max-w-sm flex-col border-l border-outline bg-surface/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 ${queueOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-outline p-4">
          <h2 className="text-lg font-bold">Queue <span className="text-sm font-normal text-muted">({queue.length})</span></h2>
          <div className="flex items-center gap-2">
            {queue.length > 0 && <button onClick={clearQueue} className="text-sm font-semibold text-accent">Clear</button>}
            <IconButton icon="close" label="Close" onClick={() => setQueueOpen(false)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {queue.length === 0 && <p className="p-6 text-center text-sm text-muted">Your queue is empty.</p>}
          {queue.map((t, i) => (
            <div key={`${t.id}-${i}`} className={`flex items-center gap-2 rounded-xl p-2 ${i === index ? "bg-raised" : "hover:bg-raised/60"}`}>
              <button onClick={() => jumpTo(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Artwork src={t.artwork} size={40} />
                <div className="min-w-0">
                  <p className={`truncate text-sm font-semibold ${i === index ? "text-accent" : ""}`}>{i === index && "▶ "}{t.title}</p>
                  <p className="truncate text-xs text-muted">{t.artist}</p>
                </div>
              </button>
              <div className="flex flex-col">
                <button aria-label="Move up" disabled={i === 0} onClick={() => moveInQueue(i, -1)} className="text-muted hover:text-text disabled:opacity-20"><Icon name="up" size={18} /></button>
                <button aria-label="Move down" disabled={i === queue.length - 1} onClick={() => moveInQueue(i, 1)} className="text-muted hover:text-text disabled:opacity-20"><Icon name="down" size={18} /></button>
              </div>
              <IconButton icon="close" label="Remove" size={18} onClick={() => removeFromQueue(i)} />
            </div>
          ))}
          {rel.length > 0 && (
            <>
              <h3 className="mb-1 mt-5 px-2 text-sm font-bold uppercase tracking-wider text-subtle">Up next suggestions</h3>
              {rel.slice(0, 8).map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-raised/60">
                  <Artwork src={t.artwork} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{t.title}</p>
                    <p className="truncate text-xs text-muted">{t.artist}</p>
                  </div>
                  <IconButton icon="plus" label="Add to queue" size={18} onClick={() => addToQueue(t)} />
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
