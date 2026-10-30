const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngày "YYYY-MM-DD" theo múi giờ `timeZone` tại thời điểm `at`. */
export function dateInZone(at: Date, timeZone: string): string {
  // en-CA cho sẵn dạng YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(at);
}

/** Cộng/trừ ngày trên chuỗi "YYYY-MM-DD" (lịch thuần, không phụ thuộc múi giờ). */
export function addDays(date: string, days: number): string {
  const [, y, m, d] = DATE_PATTERN.exec(date) ?? [];
  if (!y) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days)).toISOString().slice(0, 10);
}

/** Độ lệch (ms) của múi giờ so với UTC tại thời điểm `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** 00:00 của ngày `date` theo `timeZone`, dưới dạng thời điểm UTC. */
function startOfDay(date: string, timeZone: string): Date {
  const [, y, m, d] = DATE_PATTERN.exec(date) ?? [];
  if (!y) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const guess = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const first = guess - zoneOffsetMs(guess, timeZone);
  // Lặp lại một lần cho trường hợp đổi giờ (DST) rơi đúng nửa đêm.
  return new Date(guess - zoneOffsetMs(first, timeZone));
}

/** Khoảng [00:00 ngày `date`, 00:00 ngày kế tiếp) theo `timeZone`. */
export function dayRange(date: string, timeZone: string): { from: Date; to: Date } {
  return { from: startOfDay(date, timeZone), to: startOfDay(addDays(date, 1), timeZone) };
}

/** Ngày báo cáo: ngày được chỉ định, hoặc "hôm qua" tính từ `now` theo múi giờ. */
export function reportDate(now: Date, timeZone: string, date?: string): string {
  return date ?? addDays(dateInZone(now, timeZone), -1);
}
