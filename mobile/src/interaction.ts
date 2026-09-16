export function nightDate(timezone: string, cutoffHour: number, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  if (Number(part("hour")) < cutoffHour) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
