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
    expect(px(dockBottomOverCard())).toBeGreaterThan(px(dockBottom(false)));
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

  it('does not lay invisible tap traps over the card while compact', () => {
    resetState();
    store.set({ queue: [track as never], index: 0, route: 'home' });
    render(<SmartDock />);

    // The compact dock gives its spare width to the song card. Leaving invisible buttons there
    // would mean taps on the card's controls landed on the dock instead, so the hidden
    // destinations must take no pointer events at all.
    const dock = screen.getByRole('navigation', { name: 'Primary' });
    const hidden = Array.from(dock.querySelectorAll('[data-dock-item]')).filter(
      (el) => el.getAttribute('aria-current') !== 'page',
    );
    expect(hidden).toHaveLength(4);
    for (const el of hidden) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.className).toContain('pointer-events-none');
    }
  });

  it('still navigates from the compact dock through the accessible layer', () => {
    resetState();
    store.set({ queue: [track as never], index: 0, route: 'home' });
    render(<SmartDock />);

    // One icon is drawn, but five destinations are offered: a screen reader or keyboard user is
    // not locked out of the app because a song is playing.
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
    // Compact draws one pill, so the other four destinations are invisible — but they must still be
    // announced, or starting a song would cut a screen-reader user off from navigation. Exactly one
    // copy of each label: the drawing and the accessible layer must not both speak.
    for (const label of ['Home', 'Search', 'Library', 'Downloads', 'Settings']) {
      expect(screen.getAllByRole('button', { name: label })).toHaveLength(1);
    }
    for (const label of ['Search', 'Library', 'Downloads', 'Settings']) {
      expect(screen.getByRole('button', { name: label }).closest('.sr-only')).not.toBeNull();
    }
  });
});

describe('SongCard', () => {
  it('renders the track and opens the player from the title', () => {
    const onOpen = vi.fn();
    render(
      <SongCard track={track as never} playing={false} progress={0} onToggle={vi.fn()} onNext={vi.fn()} onOpen={onOpen} />,
    );
    expect(screen.getByText('Jhol')).toBeTruthy();
    // Artwork and title both open the player, so both carry the same label by intent.
    const [opener] = screen.getAllByRole('button', { name: /Open player for Jhol/i });
    fireEvent.click(opener!);
    expect(onOpen).toHaveBeenCalled();
  });

  it('exposes transport as named controls', () => {
    const onToggle = vi.fn();
    const onNext = vi.fn();
    render(
      <SongCard track={track as never} playing progress={0.5} onToggle={onToggle} onNext={onNext} onOpen={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('clamps progress instead of overflowing the hairline', () => {
    const { container } = render(
      <SongCard track={track as never} playing progress={4} onToggle={vi.fn()} onNext={vi.fn()} onOpen={vi.fn()} />,
    );
    const bar = container.querySelector<HTMLElement>('.bg-\\[var\\(--accent\\)\\]');
    expect(bar?.style.width).toBe('100%');
  });
});
