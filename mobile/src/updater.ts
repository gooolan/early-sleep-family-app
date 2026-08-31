import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

const backendStorageKey = "earlySleep.backend";
const queuedVersionStorageKey = "earlySleep.update.queuedVersion";
const updateCheckTimeout = 15_000;

type UpdateManifest = {
  webVersion: string;
  bundleUrl: string;
  sha256: string;
  minimumNativeVersionCode: number;
};

export function initializeLiveUpdates() {
  if (!Capacitor.isNativePlatform()) return;

  void CapacitorUpdater.notifyAppReady()
    .then(() => checkForLiveUpdate())
    .catch((error: unknown) => console.warn("Live update initialization failed", error));
}

async function checkForLiveUpdate() {
  const backendURL = configuredBackendURL();
  if (!backendURL) return;

  const manifest = await fetchUpdateManifest(backendURL);
  if (!manifest) return;

  const [current, appInfo] = await Promise.all([
    CapacitorUpdater.current(),
    App.getInfo(),
  ]);
  const nativeVersionCode = Number(appInfo.build);
  if (!Number.isInteger(nativeVersionCode) || nativeVersionCode < manifest.minimumNativeVersionCode) return;

  if (compareVersions(manifest.webVersion, current.bundle.version) <= 0) {
    localStorage.removeItem(queuedVersionStorageKey);
    return;
  }
  if (localStorage.getItem(queuedVersionStorageKey) === manifest.webVersion) return;

  const bundleURL = new URL(manifest.bundleUrl, `${backendURL}/`).toString();
  const bundle = await CapacitorUpdater.download({
    url: bundleURL,
    version: manifest.webVersion,
    checksum: manifest.sha256,
  });
  await CapacitorUpdater.next({ id: bundle.id });
  localStorage.setItem(queuedVersionStorageKey, manifest.webVersion);
}

async function fetchUpdateManifest(backendURL: string): Promise<UpdateManifest | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), updateCheckTimeout);
  try {
    const response = await fetch(`${backendURL}/updates/manifest.json`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const value: unknown = await response.json();
    return isUpdateManifest(value) ? value : null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function configuredBackendURL() {
  const value = (localStorage.getItem(backendStorageKey) ?? import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<UpdateManifest>;
  return (
    typeof manifest.webVersion === "string"
    && /^\d+(?:\.\d+)+$/.test(manifest.webVersion)
    && typeof manifest.bundleUrl === "string"
    && manifest.bundleUrl.length > 0
    && typeof manifest.sha256 === "string"
    && /^[a-f\d]{64}$/i.test(manifest.sha256)
    && Number.isInteger(manifest.minimumNativeVersionCode)
    && (manifest.minimumNativeVersionCode ?? 0) > 0
  );
}

function compareVersions(left: string, right: string) {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  if (!leftParts || !rightParts) return left === right ? 0 : 1;

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function numericVersionParts(value: string) {
  if (!/^\d+(?:\.\d+)+$/.test(value)) return null;
  return value.split(".").map(Number);
}
