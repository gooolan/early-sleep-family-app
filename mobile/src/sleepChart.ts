export type SleepPoint = { x: number; y: number };

export function sleepMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour < 12 ? hour + 24 : hour) * 60 + minute;
}

export function sleepAxis(times: string[], idealTime: string) {
  const values = [...times, idealTime].map(sleepMinutes);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = high - low > 360 ? 120 : high - low > 150 ? 60 : 30;
  const minimum = Math.floor((low - 15) / step) * step;
  const maximum = Math.max(minimum + step * 3, Math.ceil((high + 15) / step) * step);
  const ticks = Array.from({ length: Math.round((maximum - minimum) / step) + 1 }, (_, index) => minimum + index * step);
  return { minimum, maximum, ticks };
}

export function sleepTick(minutes: number) {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// Horizontal tangents soften each segment without overshooting either observed value.
// Missing records start a new subpath, rather than implying sleep on an unrecorded day.
export function sleepCurve(points: Array<SleepPoint | null>) {
  let previous: SleepPoint | null = null;
  return points.map((point) => {
    if (!point) { previous = null; return ""; }
    const midpoint = previous ? (previous.x + point.x) / 2 : point.x;
    const segment = previous
      ? `C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`
      : `M ${point.x} ${point.y}`;
    previous = point;
    return segment;
  }).join(" ");
}
