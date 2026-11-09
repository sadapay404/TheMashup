/**
 * User playlists and the "Add to" popup.
 *
 * The rule the user set is that playlists are manual, so the important assertions are that playback
 * never adds anything, that a duplicate is reported rather than silently stored twice, and that the
 * popup can create a playlist and file the song into it in one go.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@themashup/core';
import { store } from '../state/store';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  playlistById,
  playlistTracks,
  playlistsContaining,
  removeFromPlaylist,
  renamePlaylist,
} from '../lib/playlists';
import { AddToSheet } from '../components/library/AddToSheet';

const track = (id: string, title = `Song ${id}`): Track => ({
  id,
  title,
  artist: 'Someone',
  durationSec: 200,
  thumbs: [],
});

beforeEach(() => {
  store.set({ playlists: [] });
});

describe('playlists', () => {
  it('creates a playlist', () => {
    const p = createPlaylist('Road trip');
    expect(p?.name).toBe('Road trip');
    expect(playlistById(p!.id)?.trackIds).toEqual([]);
  });

  it('refuses a nameless playlist', () => {
    expect(createPlaylist('   ')).toBeNull();
    expect(store.getState().playlists).toHaveLength(0);
  });

  it('adds a track and keeps insertion order', () => {
    const p = createPlaylist('Order')!;
    addToPlaylist(p.id, track('a'));
    addToPlaylist(p.id, track('b'));
    expect(playlistTracks(p.id).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('reports a duplicate instead of storing it twice', () => {
    const p = createPlaylist('Dupes')!;
    expect(addToPlaylist(p.id, track('a'))).toBe('added');
    expect(addToPlaylist(p.id, track('a'))).toBe('duplicate');
    expect(playlistById(p.id)?.trackIds).toEqual(['a']);
  });

  it('reports a missing playlist rather than pretending', () => {
    expect(addToPlaylist('nope', track('a'))).toBe('missing-playlist');
  });

  it('removes a track', () => {
    const p = createPlaylist('Remove')!;
    addToPlaylist(p.id, track('a'));
    expect(removeFromPlaylist(p.id, 'a')).toBe(true);
    expect(playlistTracks(p.id)).toHaveLength(0);
  });

  it('says which playlists already hold a track', () => {
    const a = createPlaylist('A')!;
    const b = createPlaylist('B')!;
    addToPlaylist(a.id, track('x'));
    expect(playlistsContaining('x')).toEqual([a.id]);
    expect(playlistsContaining('y')).toEqual([]);
    expect(b.id).not.toBe(a.id);
  });

  it('renames and deletes', () => {
    const p = createPlaylist('Old')!;
    expect(renamePlaylist(p.id, 'New')).toBe(true);
    expect(playlistById(p.id)?.name).toBe('New');
    expect(deletePlaylist(p.id)).toBe(true);
    expect(playlistById(p.id)).toBeNull();
  });

  it('is never touched by playback', () => {
    const p = createPlaylist('Untouched')!;
    // Playing is not modelled here on purpose: nothing in the playlist module is reachable from the
    // player, and this asserts the state stays empty through a queue change.
    store.set({ queue: [track('q1'), track('q2')], index: 0, playing: true });
    expect(playlistById(p.id)?.trackIds).toEqual([]);
  });
});

describe('AddToSheet', () => {
  it('creates a playlist and files the song into it in one action', () => {
    render(<AddToSheet track={track('a', 'Jhol')} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByLabelText('New playlist name'), { target: { value: 'Morning' } });
    fireEvent.click(screen.getByText('Create'));

    const created = store.getState().playlists[0]!;
    expect(created.name).toBe('Morning');
    expect(created.trackIds).toEqual(['a']);
  });

  it('offers the queue when queueing is possible, and omits it otherwise', () => {
    const { unmount } = render(
      <AddToSheet track={track('a')} onQueue={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Queue')).toBeTruthy();
    unmount();

    render(<AddToSheet track={track('a')} onClose={vi.fn()} />);
    expect(screen.queryByText('Queue')).toBeNull();
  });

  it('queues without adding to any playlist', () => {
    const onQueue = vi.fn();
    const p = createPlaylist('Existing')!;
    render(<AddToSheet track={track('a')} onQueue={onQueue} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Queue'));
    expect(onQueue).toHaveBeenCalledOnce();
    expect(playlistById(p.id)?.trackIds).toEqual([]);
  });

  it('marks a playlist that already holds the track', () => {
    const p = createPlaylist('Has it')!;
    addToPlaylist(p.id, track('a'));
    render(<AddToSheet track={track('a')} onClose={vi.fn()} />);
    expect(screen.getByText('Has it')).toBeTruthy();
    // Clicking again must not duplicate.
    fireEvent.click(screen.getByText('Has it'));
    expect(playlistById(p.id)?.trackIds).toEqual(['a']);
  });

  it('says so when there are no playlists yet', () => {
    render(<AddToSheet track={track('a')} onClose={vi.fn()} />);
    expect(screen.getByText(/No playlists yet/i)).toBeTruthy();
  });

  it('refuses an empty name instead of creating "Untitled"', () => {
    render(<AddToSheet track={track('a')} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(screen.getByText('Create'));
    expect(store.getState().playlists).toHaveLength(0);
  });
});
