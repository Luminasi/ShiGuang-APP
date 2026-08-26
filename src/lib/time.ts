/** 日期时间工具：计划、散步等模块共用 */

/** Date → YYYY-MM-DD（本地时区） */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 今天（本地） */
export function todayStr(): string {
  return toDateStr(new Date());
}

/** YYYY-MM-DD → Date（本地零点） */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 日期偏移 n 天 */
export function addDays(s: string, n: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** 分钟数（0~1439）→ "HH:MM" */
export function fmtMin(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** "HH:MM" → 分钟数；格式不对返回 null */
export function parseMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 中文日期标签：8月26日 星期三（手动拼月日，避免本地化数据缺失） */
export function dateLabel(s: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "long",
  }).formatToParts(parseDateStr(s));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}月${get("day")}日 ${get("weekday")}`;
}
