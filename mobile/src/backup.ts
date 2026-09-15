import type { FamilyBackup } from "./types";

const prefix = "earlySleep.backup.v1:";
const legacyPrefix = "earlySleep.rescue.v1:";
export const backupChanged = "early-sleep-backup-changed";
const statuses = new Map<string, string>();
export function backupStatus(url: string) { return statuses.get(backend(url)) ?? ""; }
export function publishBackupStatus(url: string, error: string) {
  statuses.set(backend(url), error);
  window.dispatchEvent(new CustomEvent(backupChanged));
}

export type LocalBackup = {
  backendURL: string;
  latest: FamilyBackup;
  previous?: FamilyBackup;
};

function backend(value: string) { return value.replace(/\/$/, ""); }
function keyFor(url: string, id: string) { return `${prefix}${encodeURIComponent(backend(url))}:${encodeURIComponent(id)}`; }

export function saveBackup(url: string, backup: FamilyBackup, storage: Storage = localStorage) {
  const family = backup.family;
  if (backup.formatVersion !== 1 || !family?.id || !family.members || Array.isArray(family.members)
    || !family.activeWeek?.checkins || !Array.isArray(family.weeklyArchives)
    || !Array.isArray(family.products) || !Array.isArray(family.priceStores) || !Array.isArray(family.priceRecords)
    || !Number.isFinite(family.revision) || !Number.isFinite(Date.parse(backup.exportedAt))) {
    throw new Error("服务器未返回完整家庭备份，本地旧备份已保留");
  }
  // Keep the portable export intact except for authentication hashes.
  const clean = JSON.parse(JSON.stringify(backup)) as FamilyBackup;
  delete clean.family.joinCodeHash;
  for (const member of Object.values(clean.family.members)) delete member.tokenHash;
  const key = keyFor(url, family.id);
  const raw = storage.getItem(key);
  const current = raw ? JSON.parse(raw) as LocalBackup : undefined;
  if (current && family.revision < current.latest.family.revision) {
    throw new Error("服务器数据版本早于本地备份，已保留本地数据，请先导出备份核对");
  }
  if (current && JSON.stringify(current.latest.family) === JSON.stringify(clean.family)) return;
  const record: LocalBackup = { backendURL: backend(url), latest: clean, previous: current?.latest };
  // A single atomic setItem preserves both existing copies when storage is full.
  storage.setItem(key, JSON.stringify(record));
}

export function listBackups(storage: Storage = localStorage): LocalBackup[] {
  const result: LocalBackup[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null") as LocalBackup;
      if (value?.latest?.family?.id) result.push(value);
    } catch { /* Preserve unreadable entries for manual recovery. */ }
  }
  return result.sort((left, right) => Date.parse(right.latest.exportedAt) - Date.parse(left.latest.exportedAt));
}

export function preserveLegacyCache(storage: Storage = localStorage) {
  const raw = storage.getItem("earlySleep.family.v1");
  if (!raw) return;
  const value = JSON.parse(raw);
  if (!value?.family?.id) return;
  const key = `${legacyPrefix}${encodeURIComponent(backend(value.backendURL ?? ""))}:${encodeURIComponent(value.family.id)}`;
  // The first rescued copy must survive a later empty server response.
  if (!storage.getItem(key)) storage.setItem(key, raw);
}

export function listLegacyCaches(storage: Storage = localStorage): { key: string; raw: string }[] {
  const result: { key: string; raw: string }[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === "earlySleep.family.v1" || key?.startsWith(legacyPrefix)) {
      const raw = storage.getItem(key);
      if (raw) result.push({ key, raw });
    }
  }
  return result;
}

