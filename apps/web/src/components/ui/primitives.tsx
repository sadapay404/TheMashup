/** Design-system primitives. Every one honours the motion + a11y contract. */

import { motion, type HTMLMotionProps } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushOverlay } from '@/lib/overlays';

export const snap = { type: 'spring', stiffness: 420, damping: 34, mass: 1 } as const;
export const settle = { type: 'spring', stiffness: 320, damping: 30, mass: 1 } as const;
export const glide = { type: 'spring', stiffness: 180, damping: 26, mass: 1 } as const;
export const melt = { type: 'spring', stiffness: 260, damping: 28, mass: 1 } as const;

export function Pressable({
  children,
  className = '',
  label,
  onClick,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClick?: (() => void) | undefined;
} & Omit<HTMLMotionProps<'button'>, 'onClick'>) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      transition={snap}
      className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({
  children,
  label,
  onClick,
  active = false,
  size = 'md',
}: {
  children: ReactNode;
  label: string;
  onClick?: (() => void) | undefined;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-16 w-16' : 'h-11 w-11';
  return (
    <Pressable
      label={label}
      onClick={onClick}
      className={`${dim} ${active ? 'text-[var(--accent)]' : 'text-[var(--color-text)]'} hover:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)]`}
    >
      {children}
    </Pressable>
  );
}

/** Skeleton with a travelling sheen — used by every loading state. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] ${className}`}>
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)',
        }}
        animate={{ x: ['-100%', '100%'] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  icon,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={glide}
      className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center"
    >
      {icon ? <div className="mb-1 text-[var(--color-text-3)]">{icon}</div> : null}
      <h3 className="text-balance text-lg font-semibold">{title}</h3>
      <p className="max-w-sm text-balance text-sm leading-relaxed text-[var(--color-text-2)]">{detail}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--on-accent)] transition active:scale-95"
        >
          {action.label}
        </button>
      ) : null}
    </motion.div>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      transition={snap}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? 'border-transparent bg-[var(--accent)] text-[var(--on-accent)]'
          : 'border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] text-[var(--color-text-2)] hover:text-[var(--color-text)]'
      }`}
    >
      {children}
    </motion.button>
  );
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A bottom sheet that can actually be dismissed.
 *
 * Two separate bugs came from sheets rendered in place:
 *
 *  1. `position: fixed` is resolved against the nearest transformed ancestor, not the viewport. The
 *     page container animates `scale`/`y`, so a sheet rendered inside it was pinned to a few hundred
 *     pixels of the page instead of the screen — the backdrop's "tap outside to close" area was the
 *     only visible sliver, and the panel sat in the wrong place. Every sheet therefore portals to
 *     `document.body`, where there is no transformed ancestor.
 *  2. Nothing told hardware back the sheet existed. Registering on the overlay stack means back
 *     closes the sheet before it touches navigation, instead of navigating away underneath it.
 *
 * Escape is handled too, so the same contract holds on a desktop shell.
 */
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const off = pushOverlay(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      off();
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={glide}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto max-w-2xl rounded-t-[26px] border-t border-[var(--hairline)] bg-[var(--color-void)] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="truncate pr-3 text-[14px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-[12px] text-[var(--color-text-3)]">
            Cancel
          </button>
        </div>
        {children}
      </motion.div>
    </>,
    document.body,
  );
}
