/**
 * Downloads play policy.
 *
 * The rule the user asked for: **only in Downloads**, songs play back to back with no delay, and there
 * is a shuffle button.
 *
 * The parts worth pinning are the ones a screenshot cannot show:
 *
 *   - the queue knows it came from Downloads, because that is what the player switches on when a track
 *     ends several screens later;
 *   - shuffle here is scoped to this list and cannot leak into the rest of the app;
 *   - Play starts the list, and with shuffle on it does not always start at track one.
 *
 * The end-of-queue behaviour itself lives in `usePlayer` and is covered by the transport tests; this
 * file pins the surface that feeds it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DownloadsScreen } from '../components/downloads/DownloadsScreen';
import { store, type DownloadJob } from '../state/store';

const track = (id: string, title: string) => ({
  id,
  title,
  artist: 'Someone',
  album: 'Somewhere',
  durationSec: 200,
  thumbs: [],
});

const job = (id: string): DownloadJob => ({
  id,
  track: track(id, `Song ${id}`) as never,
  target: '128k m4a',
  progress: 1,
  state: 'done',
  createdAt: Date.now(),
  kind: 'music',
  folderId: null,
});

beforeEach(() => {
  store.set({
    folders: [
      { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
      { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
    ],
    downloads: [job('a'), job('b'), job('c')],
    playlistBatches: [],
    shuffle: false,
    queueOrigin: 'library',
    shuffleBeforeDownloads: null,
    toast: null,
  });
});

describe('Downloads: autoplay and shuffle', () => {
  it('marks the queue as a downloads queue when a row is played', () => {
    const onPlay = vi.fn();
    render(<DownloadsScreen onPlay={onPlay} />);
    // The system folder is open by default, so its files are on screen. The row itself is the play
    // affordance; its accessible name is the concatenated title/artist/target text.
    fireEvent.click(screen.getByRole('button', { name: /^Song a/ }));

    expect(onPlay).toHaveBeenCalledTimes(1);
    // Third argument is the origin. Without it the player would reach for network radio at the end of
    // the list, which is the delay the user is complaining about.
    expect(onPlay.mock.calls[0]![2]).toBe('downloads');
  });

  it('plays the whole folder, not just one track', () => {
    const onPlay = vi.fn();
    render(<DownloadsScreen onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play 3' }));

    const [, list, origin] = onPlay.mock.calls[0]!;
    expect(origin).toBe('downloads');
    expect((list as unknown[]).length).toBe(3);
  });

  it('starts at the first track when shuffle is off', () => {
    const onPlay = vi.fn();
    render(<DownloadsScreen onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play 3' }));

    const [first] = onPlay.mock.calls[0]!;
    expect((first as { id: string }).id).toBe('a');
  });

  it('has a shuffle button that reflects its own state', () => {
    render(<DownloadsScreen onPlay={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Shuffle (on|off) for downloads/i });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(store.getState().shuffle).toBe(true);
    expect(
      screen.getByRole('button', { name: /Shuffle on for downloads/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('remembers the global shuffle so leaving Downloads can restore it', () => {
    // The destructive version of this feature would leave the whole app shuffled forever. The previous
    // value is stored here and put back by playTrack() the first time something else is played.
    store.set({ shuffle: false });
    render(<DownloadsScreen onPlay={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Shuffle off for downloads/i }));

    expect(store.getState().shuffle).toBe(true);
    expect(store.getState().shuffleBeforeDownloads).toBe(false);
  });

  it('records only the first value, so toggling twice cannot forget the user’s real preference', () => {
    store.set({ shuffle: false, shuffleBeforeDownloads: null });
    render(<DownloadsScreen onPlay={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Shuffle off for downloads/i }));
    fireEvent.click(screen.getByRole('button', { name: /Shuffle on for downloads/i }));

    expect(store.getState().shuffle).toBe(false);
    // Still `false` — the value to restore — not `true` from the intermediate state.
    expect(store.getState().shuffleBeforeDownloads).toBe(false);
  });

  it('can start on a different track once shuffle is on', () => {
    const onPlay = vi.fn();
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // lands on the last track
    render(<DownloadsScreen onPlay={onPlay} />);

    fireEvent.click(screen.getByRole('button', { name: /Shuffle off for downloads/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Play 3' }));

    const [first] = onPlay.mock.calls[0]!;
    expect((first as { id: string }).id).toBe('c');
    spy.mockRestore();
  });

  it('disables both controls when nothing is stored, instead of playing silence', () => {
    store.set({ downloads: [] });
    render(<DownloadsScreen onPlay={vi.fn()} />);

    const play = screen.getByRole('button', { name: 'Nothing to play' });
    expect((play as HTMLButtonElement).disabled).toBe(true);
  });

  it('says plainly that stored files need no network', () => {
    render(<DownloadsScreen onPlay={vi.fn()} />);
    expect(screen.getByText(/no network needed/i)).toBeTruthy();
  });
});
