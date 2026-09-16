import type { Settings } from "./types";

export type ScoreLevel = { name: string; tone: "bloom" | "fresh" | "calm" | "steady" | "reset"; description: string };

export function formatScore(score: number) {
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function weeklyMaximum(settings: Settings, weekStart?: string, weekEnd?: string) {
  const weekday = Math.max(...settings.weekdayTiers.map((tier) => tier.score));
  const weekend = Math.max(...settings.weekendTiers.map((tier) => tier.score));
  if (weekStart && weekEnd) {
    return dateRange(weekStart, weekEnd).reduce((total, date) => {
      const day = new Date(`${date}T12:00:00`).getDay();
      return total + (day === 5 || day === 6 ? weekend : weekday);
    }, 0);
  }
  return weekday * 5 + weekend * 2;
}

export function scoreLevel(score: number, maximum: number): ScoreLevel {
  const ratio = maximum > 0 ? score / maximum : score > 0 ? 1 : score < 0 ? -1 : 0;
  if (ratio >= 0.8) return { name: "晨光", tone: "bloom", description: "状态闪闪发光" };
  if (ratio >= 0.55) return { name: "新芽", tone: "fresh", description: "节奏稳定生长" };
  if (ratio >= 0.25) return { name: "清风", tone: "calm", description: "正在靠近目标" };
  if (ratio >= 0) return { name: "守夜", tone: "steady", description: "再早一点就好" };
  return { name: "重启", tone: "reset", description: "下周轻轻重来" };
}

export function dateRange(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const final = new Date(`${end}T12:00:00`);
  while (cursor <= final) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}
