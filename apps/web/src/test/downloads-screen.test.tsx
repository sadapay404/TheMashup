/**
 * Downloads screen tests.
 *
 * The screen is a file manager, so the things worth pinning are the ordering the user asked for
 * (folders above files), that an in-flight download is never invisible, and that a move is a real
 * state change rather than a visual one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DownloadsScreen } from '../components/downloads/DownloadsScreen';
import { store, type DownloadJob } from '../state/store';
import { ensureFolder } from '../lib/folders';

const track = (id: string, title: string) => ({
  id,
  title,
  artist: 'Someone',
  album: 'Somewhere',
  durationSec: 200,
  thumbs: [],
});

const job = (over: Partial<DownloadJob> & { id: string }): DownloadJob => ({
  track: track(over.id, `Song ${over.id}`),
  target: '128k m4a',
  progress: 1,
  state: 'done',
  createdAt: Date.now(),
  kind: 'music',
  folderId: null,
  ...over,
});

beforeEach(() => {
  store.set({
    folders: [
      { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
      { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
    ],
    downloads: [],
    playlistBatches: [],
  });
});

describe('DownloadsScreen', () => {
  it('renders the sections and the folder list', () => {
    render(<DownloadsScreen onPlay={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Downloads' })).toBeTruthy();
    expect(screen.getByText('Songs')).toBeTruthy();
    expect(screen.getByText('Videos')).toBeTruthy();
    expect(screen.getByText('Folders')).toBeTruthy();
    expect(screen.getByText('All songs')).toBeTruthy();
  });

  it('shows folders before the in-progress files', () => {
    store.set({ downloads: [job({ id: 'p1', state: 'downloading', progress: 0.4 })] });
    const { container } = render(<DownloadsScreen onPlay={vi.fn()} />);
    const text = container.textContent ?? '';
    expect(text.indexOf('Folders')).toBeLessThan(text.indexOf('In progress'));
  });

  it('says the folder is empty instead of showing nothing at all', () => {
    render(<DownloadsScreen onPlay={vi.fn()} />);
    expect(screen.getByText(/Nothing here yet/i)).toBeTruthy();
  });

  it('lists a stored file inside its folder and plays it', () => {
    const onPlay = vi.fn();
    store.set({ downloads: [job({ id: 'a1', track: track('a1', 'Jhol') })] });
    render(<DownloadsScreen onPlay={onPlay} />);
    const row = screen.getByText('Jhol').closest('button')!;
    fireEvent.click(row);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('keeps a failed download visible with its reason, exactly once', () => {
    store.set({
      downloads: [job({ id: 'f1', track: track('f1', 'Broken'), state: 'failed', error: 'HTTP 403' })],
    });
    render(<DownloadsScreen onPlay={vi.fn()} />);
    // Once only: it belongs to the in-progress list, not also to the folder.
    expect(screen.getAllByText('Broken')).toHaveLength(1);
    expect(screen.getByText(/HTTP 403/)).toBeTruthy();
  });

  it('does not play a file that is not stored yet', () => {
    const onPlay = vi.fn();
    store.set({ downloads: [job({ id: 'q1', state: 'queued' })] });
    render(<DownloadsScreen onPlay={onPlay} />);
    expect(screen.getAllByText('Song q1')).toHaveLength(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('moves a file to another folder through the move sheet', () => {
    const playlist = ensureFolder('Jhol', 'music');
    store.set({ downloads: [job({ id: 'm1', track: track('m1', 'Moved') })] });
    render(<DownloadsScreen onPlay={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(/Move Moved to another folder/i));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Jhol'));

    expect(store.getState().downloads[0]!.folderId).toBe(playlist.id);
  });

  it('renames a user folder and refuses an empty name', () => {
    const f = ensureFolder('Jhol', 'music');
    render(<DownloadsScreen onPlay={vi.fn()} />);
    // Open the playlist folder.
    fireEvent.click(screen.getByText('Jhol'));
    fireEvent.click(screen.getByText('Rename'));

    const input = screen.getByLabelText('Folder name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(store.getState().folders.find((x) => x.id === f.id)?.name).toBe('Jhol');
  });

  it('deletes a folder without destroying the files inside it', () => {
    const f = ensureFolder('Jhol', 'music');
    store.set({ downloads: [job({ id: 'd1', track: track('d1', 'Kept'), folderId: f.id })] });
    render(<DownloadsScreen onPlay={vi.fn()} />);

    fireEvent.click(screen.getByText('Jhol'));
    fireEvent.click(screen.getByText('Delete'));

    expect(store.getState().folders.some((x) => x.id === f.id)).toBe(false);
    expect(store.getState().downloads).toHaveLength(1);
    expect(store.getState().downloads[0]!.folderId).toBe('all-songs');
  });

  it('shows live progress for a playlist downloading into its folder', () => {
    const f = ensureFolder('Jhol', 'music');
    store.set({
      playlistBatches: [
        {
          id: 'b1',
          folderId: f.id,
          name: 'Jhol',
          kind: 'music',
          trackIds: ['a', 'b', 'c', 'd'],
          cursor: 1,
          state: 'running',
          failed: 0,
          startedAt: 0,
        },
      ],
    });
    render(<DownloadsScreen onPlay={vi.fn()} />);
    expect(screen.getByText('Downloading 2 of 4')).toBeTruthy();
  });

  it('offers rename and delete only on folders the user made', () => {
    render(<DownloadsScreen onPlay={vi.fn()} />);
    expect(screen.queryByText('Rename')).toBeNull();
  });
});
