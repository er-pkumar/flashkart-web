import { useEffect, useState } from 'react';

function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

/**
 * Ticks once a second toward an absolute deadline.
 *
 * The deadline is always an absolute timestamp from the server, never a
 * client-side duration counted down locally. That way a slow render, a
 * backgrounded tab or a clock the browser throttled cannot drift away from
 * when the hold actually expires in Redis.
 *
 * `onExpire` fires once per deadline, at the moment it hits zero.
 */
export function useCountdown(deadline: string | null, onExpire?: () => void): number {
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(deadline));

  useEffect(() => {
    if (!deadline) {
      setSecondsLeft(0);
      return;
    }

    // Re-sync immediately: the deadline may have changed since the last render.
    setSecondsLeft(secondsUntil(deadline));

    let fired = false;
    const timer = setInterval(() => {
      const next = secondsUntil(deadline);
      setSecondsLeft(next);
      if (next <= 0 && !fired) {
        fired = true;
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(timer);
    // onExpire is intentionally excluded: callers pass a stable useCallback, and
    // re-subscribing on every render would restart the tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  return secondsLeft;
}

/** 95 -> "1:35", 3700 -> "1:01:40" */
export function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
