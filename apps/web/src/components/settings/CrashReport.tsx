/**
 * Crash report.
 *
 * The point of this panel is to replace "run adb logcat on a computer" with "tap copy and paste it".
 * It shows only what the device actually recorded; if the app has never crashed it says so, and if
 * the plugin is missing (a browser, or an older build) it says that instead of implying a clean
 * record.
 */

import { useEffect, useState } from 'react';
import { isNative, nativeClearCrash, nativeCrashReport, nativeInfo, nativeLogcat, type NativeInfo } from '@/lib/native';
import { store } from '@/state/store';
import { haptic } from '@/lib/haptics';
import { Chip } from '@/components/ui/primitives';
import { DownloadIcon } from '@/components/ui/icons';

type Status = 'loading' | 'none' | 'found' | 'unavailable';

export function CrashReport() {
  const [status, setStatus] = useState<Status>('loading');
  const [report, setReport] = useState('');
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isNative()) {
        if (!cancelled) setStatus('unavailable');
        return;
      }
      const [crash, meta] = await Promise.all([nativeCrashReport(), nativeInfo()]);
      if (cancelled) return;
      setInfo(meta);
      if (!crash) {
        setStatus('unavailable');
        return;
      }
      setReport(crash.text);
      setStatus(crash.found ? 'found' : 'none');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      haptic('success');
      store.notify(`${what} copied`, 'success');
    } catch {
      // Clipboard access can be denied; falling back to a textarea keeps it usable.
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
      haptic('tap');
      store.notify(`${what} copied`, 'success');
    }
  };

  const withBuild = (body: string) =>
    [
      '=== TheMashup report ===',
      info ? `build: ${info.versionName} (${info.versionCode})${info.debuggable ? ' · debuggable' : ''}` : 'build: unknown',
      info ? `device: ${info.device} · API ${info.sdk}` : '',
      info ? `package: ${info.package}` : '',
      '',
      body,
    ]
      .filter(Boolean)
      .join('\n');

  return (
    <div className="space-y-2">
      {status === 'loading' ? (
        <p className="text-[11.5px] text-[var(--color-text-3)]">Reading the device record…</p>
      ) : status === 'unavailable' ? (
        <p className="text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
          Crash recording only exists in the Android build. Here there is nothing to read, rather than
          nothing having happened.
        </p>
      ) : status === 'none' ? (
        <>
          <p className="text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
            No crash is recorded on this device. If the app closed without a message, tap below to copy
            the recent log instead — the lines before the exit usually name the cause.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip
              onClick={async () => {
                const log = await nativeLogcat(400);
                if (!log) {
                  store.notify('The log is not readable on this device', 'error');
                  return;
                }
                await copy(withBuild(log.text || '(empty)'), 'Log');
              }}
            >
              Copy recent log
            </Chip>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-[var(--color-text-3)]">
              Last crash · {report.split('\n')[1]?.replace('time: ', '') ?? 'unknown time'}
            </p>
            <button
              type="button"
              onClick={() => {
                haptic('tap');
                setExpanded((v) => !v);
              }}
              className="shrink-0 text-[11px] font-semibold text-[var(--accent)]"
            >
              {expanded ? 'Hide' : 'Show'}
            </button>
          </div>
          {expanded ? (
            <pre className="max-h-64 overflow-auto rounded-xl bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] p-2.5 font-[family-name:var(--font-mono)] text-[10px] leading-relaxed text-[var(--color-text-2)]">
              {report.slice(0, 6000)}
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <Chip onClick={() => void copy(withBuild(report), 'Crash report')}>Copy crash report</Chip>
            <Chip
              onClick={async () => {
                const log = await nativeLogcat(400);
                if (log) await copy(withBuild(log.text || '(empty)'), 'Log');
              }}
            >
              Copy recent log
            </Chip>
            <Chip
              onClick={async () => {
                const ok = await nativeClearCrash();
                if (!ok) {
                  store.notify('Could not clear the record', 'error');
                  return;
                }
                haptic('tap');
                setReport('');
                setStatus('none');
                store.notify('Crash record cleared', 'info');
              }}
            >
              Clear
            </Chip>
          </div>
        </>
      )}

      {info ? (
        <p className="font-[family-name:var(--font-mono)] text-[10px] leading-relaxed text-[var(--color-text-3)]">
          {info.versionName} ({info.versionCode}) · {info.device} · API {info.sdk}
          {info.debuggable ? ' · debug' : ''}
        </p>
      ) : null}
    </div>
  );
}
