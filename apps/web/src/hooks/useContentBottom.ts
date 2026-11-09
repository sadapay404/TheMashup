/**
 * Bottom padding for a scrolling screen.
 *
 * Padding that always reserves the full stack leaves a large dead gap when nothing is playing —
 * which reads as the layout being broken in the other direction. This returns the padding for the
 * state the screen is actually in.
 *
 * Kept as a hook rather than a CSS custom property on `<body>` so it re-renders with the queue, and
 * a screen that mounts mid-playback gets the right value on its first paint rather than after the
 * next store change.
 */

import { useApp } from '@/state/store';
import { contentBottom } from '@/lib/layout';

export function useContentBottom(): string {
  const hasTrack = useApp((s) => s.index >= 0 && s.queue.length > 0);
  return contentBottom(hasTrack);
}
