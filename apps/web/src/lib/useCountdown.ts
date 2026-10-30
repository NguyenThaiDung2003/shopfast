import { useEffect, useState } from 'react';

/** Số giây còn lại tới mốc `until` (ms since epoch), cập nhật mỗi giây; `null` = không đếm. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [until]);

  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}
