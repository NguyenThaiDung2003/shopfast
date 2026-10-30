// Định dạng hiển thị theo chuẩn Việt Nam (DESIGN.md → Formatting Standards).

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const NBSP = ' ';

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const relativeFormat = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Số nguyên có dấu chấm ngăn nghìn: `1.290.000`. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Giá VND (lưu theo đồng): `1.290.000 ₫` – khoảng trắng không ngắt dòng trước `₫`. */
export function formatPrice(value: number): string {
  return `${numberFormat.format(Math.round(value))}${NBSP}₫`;
}

/** `24/10/2024` theo giờ Việt Nam. */
export function formatDate(value: DateInput): string {
  return dateFormat.format(toDate(value));
}

/** `14:35 24/10/2024` theo giờ Việt Nam. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return `${timeFormat.format(date)} ${dateFormat.format(date)}`;
}

/** `14:35 - Hôm nay`, `09:15 - Hôm qua`, còn lại `09:15 - 22/10/2024` (như danh sách đơn). */
export function formatDayTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  const days = dayDiff(date, now);
  const day = days === 0 ? 'Hôm nay' : days === 1 ? 'Hôm qua' : dateFormat.format(date);
  return `${timeFormat.format(date)} - ${day}`;
}

/** `vừa xong`, `5 phút trước`, `3 giờ trước`, `hôm qua`, `4 ngày trước`; quá 30 ngày → ngày cụ thể. */
export function formatRelativeTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'vừa xong';
  if (abs < 3_600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3_600), 'hour');
  const days = -dayDiff(date, now);
  if (Math.abs(days) <= 30) return relativeFormat.format(days, 'day');
  return dateFormat.format(date);
}

/** Thời gian chờ: `45 giây`, `2 phút 5 giây`, `1 giờ 3 phút` (hiển thị đếm ngược phía client). */
export function formatWait(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(s / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  if (hours > 0) return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
  if (minutes > 0) return seconds > 0 ? `${minutes} phút ${seconds} giây` : `${minutes} phút`;
  return `${seconds} giây`;
}

/** Đồng hồ đếm ngược `mm:ss` (hoặc `h:mm:ss`). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(s / 3_600);
  const mm = String(Math.floor((s % 3_600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Số ngày lịch (giờ Việt Nam) từ `date` tới `now`; 0 = cùng ngày. */
function dayDiff(date: Date, now: Date): number {
  const a = Date.parse(dayKeyFormat.format(date));
  const b = Date.parse(dayKeyFormat.format(now));
  return Math.round((b - a) / 86_400_000);
}
