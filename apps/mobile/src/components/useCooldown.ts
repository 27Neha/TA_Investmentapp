import { useCallback, useEffect, useState } from 'react';

/** Counts down seconds so the resend button shows the real wait instead of failing silently. */
export function useCooldown(seconds = 60) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const start = useCallback(() => setLeft(seconds), [seconds]);
  return { left, start, ready: left === 0 };
}
