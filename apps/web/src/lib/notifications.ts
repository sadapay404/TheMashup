/**
 * Notifications, on the phone.
 *
 * ## The problem this solves
 *
 * The app has always had a toast — a four-second message inside the WebView. That is fine while the
 * user is looking at the screen and useless in every other case: a download that finishes while the
 * app is backgrounded, a playlist that saves while the screen is off, a playback failure the user
 * needs to know about after switching away. None of those produced anything in the shade, because
 * nothing in the web layer could reach it.
 *
 * Every `store.notify()` now goes to both surfaces. The toast stays, because it is the right feedback
 * in the moment; the notification is the record that survives the moment.
 *
 * ## Rules
 *
 * - **Never throw.** A notification is a courtesy; it must never be able to break the action that
 *   raised it. Every call is wrapped and failures are swallowed with a boot-log line.
 * - **Capability-detected.** On the web build there is no plugin, and `post()` is a no-op.
 * - **Permission is asked once, lazily.** Not at boot — a prompt that appears before the user has
 *   done anything is the prompt everyone denies. It is asked the first time a message is actually
 *   posted, which is the first moment there is something to miss.
 * - **Stable ids.** The download service posts progress under one id; the JS side uses its own high
 *   range so a status message can never overwrite the foreground transfer row.
 */

import { isNative } from './native';

type NotifyChannel = 'alerts' | 'playback' | 'downloads';

interface CapacitorPluginRef {
  show?: (args: Record<string, unknown>) => Promise<unknown>;
  cancel?: (args: Record<string, unknown>) => Promise<unknown>;
  status?: () => Promise<unknown>;
  requestPermission?: () => Promise<unknown>;
  addListener?: (event: string, cb: (data: unknown) => void) => { remove: () => void };
  takePendingRoute?: () => Promise<unknown>;
}

function plugin(): CapacitorPluginRef | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (cap?.Plugins?.MashupNotify as CapacitorPluginRef | undefined) ?? null;
}

/**
 * Ids the JS surface owns.
 *
 * 6000+ is chosen to sit clear of the native ids (`4211` progress, `4212` result, `1` media session) so
 * a "Downloaded" toast can never overwrite the progress row the user is watching.
 */
const ID_FIRST = 6000;
const ID_LAST = 6099;

/** A single reused id for transient messages: newer information replaces older, never stacks. */
const ID_STATUS = 6000;

let permissionAsked = false;
let permissionGranted = false;

/** Whether the shade can actually be reached right now. Cheap; safe to call every render. */
export async function notificationsAvailable(): Promise<boolean> {
  const p = plugin();
  if (!p || !isNative()) return false;
  try {
    const res = (await p.status?.()) as { granted?: boolean } | undefined;
    permissionGranted = Boolean(res?.granted);
    return permissionGranted;
  } catch {
    return false;
  }
}

/**
 * Post a notification, or update the standing status message.
 *
 * Returns whether it was actually shown, so a caller that cares (the download sheet) can add a line of
 * honest UI when notifications are switched off at the OS level instead of pretending it worked.
 */
export async function postNotification(input: {
  title: string;
  body?: string;
  /** 'alerts' for anything the user must know, 'downloads' for transfer news. */
  channel?: NotifyChannel;
  /** Keep it in the shade until dismissed. */
  ongoing?: boolean;
  /** 0-100, or omit for no progress bar. */
  progress?: number;
  /** Route to open when tapped, e.g. 'downloads'. */
  route?: string;
  /** A stable id (6000-6099) to update in place; omit for the shared status slot. */
  id?: number;
}): Promise<boolean> {
  const p = plugin();
  if (!p || !isNative()) return false;

  if (!permissionGranted && !permissionAsked) {
    permissionAsked = true;
    try {
      const res = (await p.requestPermission?.()) as { granted?: boolean } | undefined;
      permissionGranted = Boolean(res?.granted);
    } catch {
      permissionGranted = false;
    }
  }
  if (!permissionGranted) return false;

  const id = clampId(input.id ?? (input.ongoing || input.progress !== undefined ? ID_STATUS + 1 : ID_STATUS));
  try {
    const res = (await p.show?.({
      id,
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      channel: input.channel ?? 'alerts',
      ...(input.ongoing ? { ongoing: true } : {}),
      ...(input.progress !== undefined ? { progress: Math.round(input.progress) } : {}),
      ...(input.route ? { route: input.route } : {}),
    })) as { shown?: boolean } | undefined;
    return Boolean(res?.shown);
  } catch {
    return false;
  }
}

export async function clearNotification(id?: number): Promise<void> {
  const p = plugin();
  if (!p || !isNative()) return;
  try {
    await p.cancel?.({ id: clampId(id ?? ID_STATUS) });
  } catch {
    /* the message was already gone */
  }
}

/** Keep ids inside the range this module owns, so a caller cannot collide with the native rows. */
function clampId(id: number): number {
  if (!Number.isFinite(id)) return ID_STATUS;
  return Math.min(ID_LAST, Math.max(ID_FIRST, Math.round(id)));
}

/**
 * Pull the route a notification tap asked for, and hand it to `apply`.
 *
 * Called once on boot and on every resume: a tap can start the app cold (the intent is parked before
 * the page exists) or arrive while it is running (`onNewIntent` parks it the same way). Both are the
 * same read, so there is no separate cold-start code path to get wrong.
 *
 * Returns false when there was nothing waiting.
 */
export async function takePendingRoute(apply: (route: string) => void): Promise<boolean> {
  const p = plugin();
  if (!p || !isNative()) return false;
  try {
    const res = (await p.takePendingRoute?.()) as { route?: string | null } | undefined;
    const route = res?.route;
    if (!route) return false;
    apply(route);
    return true;
  } catch {
    return false;
  }
}

/** Exported for tests: the id window is a contract with the Kotlin side. */
export const NOTIFICATION_ID_RANGE = { first: ID_FIRST, last: ID_LAST, status: ID_STATUS } as const;

/**
 * True for messages worth interrupting someone about.
 *
 * The distinction matters: an "Added to queue" confirmation is a toast, not a notification — pushing
 * every micro-confirmation into the shade is how an app trains its users to swipe notifications away
 * without reading them.
 */
export function deservesNotification(kind: 'info' | 'error' | 'success', text: string): boolean {
  if (kind === 'error') return true;
  // A success that names a file or a count is a result; a success that confirms a tap is not.
  if (kind === 'success') {
    return /download|saved|saving|imported|moved|cleared \d+/i.test(text);
  }
  return false;
}
