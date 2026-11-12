/**
 * Bottom stack: dock + song card.
 *
 * The bug this file exists to prevent: the dock and the card were positioned in two different files
 * from two different constants, and they disagreed. The card pinned itself to the bottom of the
 * screen while the dock floated 92px up, so the card sat underneath the dock and the dock looked
 * detached. These assertions pin the relationship, not the exact pixels — the numbers may change,
 * the ordering may not.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SmartDock } from '../components/shell/SmartDock';
import { SongCard } from '../components/player/SongCard';
import { store } from '../state/store';
import {
  CARD_H,
  DOCK_CARD_GAP,
  DOCK_H,
  cardBottom,
  contentBottom,
  dockBottom,
  dockBottomOverCard,
} from '../lib/layout';

/** Parse "calc(env(safe-area-inset-bottom) + 84px)" into the numeric part. */
const px = (css: string): number => {
  const m = css.match(/(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : NaN;
};

const track = {
  id: 'track-1',
  title: 'Jhol',
  artist: 'Someone',
  durationSec: 200,
  thumbs: [{ url: 'https://example.test/a.jpg', width: 60, height: 60 }],
};

const resetState = () => {
  store.set({ route: 'home', queue: [], index: 0, playing: false, playerOpen: false, toast: null });
};

describe('layout: dock sits above the card', () => {
  it('clears the card completely', () => {
    const cardTop = px(cardBottom()) + CARD_H;
    const dockBottomOffset = px(dockBottomOverCard());
    expect(dockBottomOffset).toBeGreaterThan(cardTop);
  });

  it('leaves exactly the stated gap between them', () => {
    const cardTop = px(cardBottom()) + CARD_H;
    expect(px(dockBottomOverCard()) - cardTop).toBe(DOCK_CARD_GAP);
  });

  it('does not change the dock when nothing is playing', () => {
    // With no card, the dock returns to the bottom. The two offsets must not be the same, or the
    // compact dock would sit on top of the card again.
    expect(px(dockBottomOverCard())).toBeGreaterThan(px(dockBottom()));
  });

  it('reserves enough bottom padding for the whole stack, so no row hides behind it', () => {
    const stackTop = px(dockBottomOverCard()) + DOCK_H;
    expect(px(contentBottom(true))).toBeGreaterThanOrEqual(stackTop);
  });

  it('reserves less padding when there is no card', () => {
    expect(px(contentBottom(false))).toBeLessThan(px(contentBottom(true)));
  });
});

describe('SmartDock', () => {
  it('shows every destination with a label when nothing is playing', () => {
    resetState();
    render(<SmartDock />);
    for (const label of ['Home', 'Search', 'Library', 'Downloads', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('draws all five destinations while a song is loaded', () => {
    resetState();
    store.set({ queue: [track as never], index: 0, route: 'home' });
    render(<SmartDock />);

    // The dock used to collapse to a single pill the moment a track loaded. That is gone: shrinking
    // navigation when music starts takes the app away from the user. All five are drawn, always.
    for (const label of ['Home', 'Search', 'Library', 'Downloads', 'Settings']) {
      const el = screen.getByRole('button', { name: label });
      expect(el.getAttribute('aria-current')).toBe(label === 'Home' ? 'page' : null);
    }
    // Nothing is hidden from assistive tech, because nothing is hidden at all.
    const dock = screen.getByRole('navigation', { name: 'Primary' });
    const hidden = Array.from(dock.querySelectorAll('[data-dock-item]')).filter(
      (el) => el.getAttribute('aria-hidden') === 'true',
    );
    expect(hidden).toHaveLength(0);
  });

  it('navigates from the dock while a song is loaded', () => {
    resetState();
    store.set({ queue: [track as never], index: 0, route: 'home' });
    render(<SmartDock />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(store.getState().route).toBe('search');
  });

  it('keeps the active destination reachable while compact', () => {
    resetState();
    store.set({ queue: [track as never], index: 0, route: 'library' });
    render(<SmartDock />);
    const active = screen.getByRole('button', { name: 'Library' });
    expect(active.getAttribute('aria-current')).toBe('page');
  });

  it('names every destination in compact mode, so nothing is unreachable by name', () => {
    resetState();
    store.set({ queue: [track as never], index: 0, route: 'home' });
    render(<SmartDock />);

    // This used to be hard-won: the compact dock drew one pill and had to republish the other four
    // as sr-only buttons so screen readers were not locked out of navigation. Once the dock stopped
    // shrinking, the problem disappeared — every destination is a real, visible, named button.
    for (const label of ['Home', 'Search', 'Library', 'Downloads', 'Settings']) {
      expect(screen.getAllByRole('button', { name: label })).toHaveLength(1);
    }
  });
});

describe('SongCard', () => {
  it('renders the track and opens the player from the title', () => {
    const onOpen = vi.fn();
    render(
      <SongCard track={track as never} playing={false} onToggle={vi.fn()} onOpen={onOpen} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(screen.getByText('Jhol')).toBeTruthy();
    // Artwork and title both open the player, so both carry the same label by intent.
    const [opener] = screen.getAllByRole('button', { name: /Open player for Jhol/i });
    fireEvent.click(opener!);
    expect(onOpen).toHaveBeenCalled();
  });

  it('exposes transport, save and stop as named controls', () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    const onDownload = vi.fn();
    render(
      <SongCard
        track={track as never}
        playing
        onToggle={onToggle}
        onOpen={vi.fn()}
        onClose={onClose}
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save for offline listening' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop and close the player' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clamps progress instead of overflowing the hairline', () => {
    // The hairline now subscribes to the store itself, so the overrun is staged there rather than
    // passed as a prop. A stale duration must not paint past the end of the card.
    store.set({ positionSec: 400, durationSec: 100 });
    const { container } = render(
      <SongCard track={track as never} playing onToggle={vi.fn()} onOpen={vi.fn()} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    const bar = container.querySelector<HTMLElement>('.bg-\\[var\\(--accent\\)\\]');
    expect(bar?.style.width).toBe('100%');
    store.set({ positionSec: 0, durationSec: 0 });
  });
});
