export type RuleTier = { end: string; score: number; fine: number };
export type Settings = {
  idealTime: string;
  cutoffHour: number;
  weekdayTiers: RuleTier[];
  weekendTiers: RuleTier[];
  rewardNote: string;
};
export type Member = { id: string; name: string; role: "owner" | "member"; phone?: string };
export type DailyMemberResult = { time: string; score: number; fine: number; source: string; exempt?: boolean };
export type DayResult = { date: string; members: Record<string, DailyMemberResult> };
export type PendingChange = {
  id: string;
  weekStart: string;
  date: string;
  memberId: string;
  requestedBy: string;
  kind: "upsert";
  originalTime?: string;
  proposedTime?: string;
  createdAt: string;
};
export type Exemption = { date: string; memberId: string; approvedAt: string };
export type PendingExemption = {
  id: string;
  weekStart: string;
  date: string;
  memberId: string;
  requestedBy: string;
  createdAt: string;
};
export type RewardReviewStatus = {
  cycleStartedAt: string;
  nextReviewAt: string;
  due: boolean;
  daysRemaining: number;
};
export type MemberSummary = {
  totalScore: number;
  totalFine: number;
  checkinDays: number;
  averageSleepTime: string;
};
export type WeekSummary = {
  members: Record<string, MemberSummary>;
  completionRate: number;
  totalCheckins: number;
  expectedCheckins: number;
};
export type ActiveWeek = {
  weekStart: string;
  weekEnd: string;
  weekCalendar?: string;
  rewardRuleVersion?: string;
  settings: Settings;
  days: DayResult[];
  summary: WeekSummary;
};
export type Archive = {
  weekStart: string;
  weekEnd: string;
  weekCalendar?: string;
  rewardRuleVersion?: string;
  archivedAt: string;
  settingsSnapshot: Settings;
  dailySnapshot: DayResult[];
  summary: WeekSummary;
  exemptionsSnapshot?: Exemption[];
};
export type Family = {
  id: string;
  name: string;
  timezone: string;
  currentMember: Member;
  members: Member[];
  activeWeek: ActiveWeek;
  weeklyArchives: Archive[];
  pendingChanges: PendingChange[];
  pendingExemptions: PendingExemption[];
  rewardReview: RewardReviewStatus;
};
export type FamilySession = { token: string; joinCode?: string; family: Family };
export type IdentityStatus = { exists: boolean; phone: string; verificationRequired: boolean };
export type FamilyBackup = { formatVersion: number; exportedAt: string; family: unknown };

export type PriceUnit = "gram" | "kilogram" | "jin" | "milliliter" | "liter" | "piece" | "box" | "bottle";
export type NormalizedPriceUnit = "jin" | "liter" | "piece" | "box" | "bottle";
export type Product = { id: string; name: string; iconKey?: string; createdAt: string };
export type PriceStore = { id: string; name: string; brandKey?: string; createdAt: string };
export type PriceRecord = {
  id: string;
  productId: string;
  storeId: string;
  memberId: string;
  purchasedAt: string;
  entryMode: "unit_price" | "total_price";
  unitPrice?: number;
  totalPrice?: number;
  quantity?: number;
  unit: PriceUnit;
  normalizedPrice: number;
  normalizedUnit: NormalizedPriceUnit;
  priceKind: "regular" | "discount";
  referencePrice?: number;
  referenceUnit?: PriceUnit;
  quality?: number;
  createdAt: string;
  updatedAt: string;
};
export type PriceCatalog = { products: Product[]; stores: PriceStore[]; records: PriceRecord[] };
export type SavePriceRecordInput = {
  productId: string;
  storeId: string;
  purchasedAt: string;
  entryMode: "unit_price" | "total_price";
  unitPrice?: number;
  totalPrice?: number;
  quantity?: number;
  unit: PriceUnit;
  priceKind: "regular" | "discount";
  referencePrice?: number;
  referenceUnit?: PriceUnit;
  quality?: number;
};
