/**
 * UI mount tests. These catch the class of bug a type-checker cannot: bad hooks, bad renders,
 * crashes on first paint, and boundaries failing to contain a failure.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { Boundary } from '../components/shell/Boundary';
import { store } from '../state/store';
import { MiniPlayer } from '../components/player/MiniPlayer';
import { NavPill } from '../components/shell/NavPill';

const track = {
  id: 'abc123def45',
  title: 'Wonderwall',
  artist: 'Oasis',
  album: 'Whatever',
  durationSec: 258,
  thumbs: [{ url: 'https://example.test/a.jpg', width: 60, height: 60 }],
};

function resetState() {
  store.set({
    route: 'home',
    playerOpen: false,
    queue: [],
    index: -1,
    playing: false,
    positionSec: 0,
    durationSec: 0,
    history: [],
    downloads: [],
    toast: null,
    searchQuery: '',
    amoled: false,
  });
}

describe('App shell', () => {
  it('renders home without throwing', () => {
    resetState();
    render(<App />);
    expect(screen.getByText('TheMashup')).toBeTruthy();
    expect(screen.getByText(/Remember a lyric/i)).toBeTruthy();
  });

  it('navigates between all four routes', async () => {
    resetState();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/lyric you remember/i)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    await waitFor(() => expect(screen.getByText('Library')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByText('Run diagnostics')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(screen.getByText(/Remember a lyric/i)).toBeTruthy());
  });

  it('shows the empty history state honestly', async () => {
    resetState();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    await waitFor(() => expect(screen.getByText(/history is empty/i)).toBeTruthy());
  });

  it('opens the player sheet when a track is queued and the mini-player is tapped', async () => {
    resetState();
    store.set({ queue: [track], index: 0 });
    render(<App />);

    // Mini player is visible because a track exists.
    const openBtns = await screen.findAllByRole('button', { name: /Open full player/i });
    const openBtn = openBtns[0];
    if (!openBtn) throw new Error('mini player open button missing');
    fireEvent.click(openBtn);

    await waitFor(() => expect(screen.getByRole('dialog', { name: /Now playing/i })).toBeTruthy());
  });
});

describe('Component contracts', () => {
  it('mini player exposes an accessible pause control when playing', () => {
    const onToggle = vi.fn();
    render(
      <MiniPlayer
        track={track}
        playing
        progress={0.4}
        onToggle={onToggle}
        onNext={() => undefined}
        onOpen={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('nav pill marks the current route for assistive tech', () => {
    store.set({ route: 'library' });
    render(<NavPill />);
    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('Error boundary containment', () => {
  function Boom(): never {
    throw new Error('kaboom');
  }

  it('catches a child crash and keeps the rest of the tree alive', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <p>alive</p>
        <Boundary scope="Danger">
          <Boom />
        </Boundary>
      </div>,
    );
    expect(screen.getByText('alive')).toBeTruthy();
    expect(screen.getByText(/Danger hit a problem/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
    spy.mockRestore();
  });
});
