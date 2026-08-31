import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

const backendStorageKey = "earlySleep.backend";
const pendingVersionStorageKey = "earlySleep.update.pendingVersion";
const pendingBundleIDStorageKey = "earlySleep.update.pendingBundleId";
const legacyQueuedVersionStorageKey = "earlySleep.update.queuedVersion";
const updateCheckTimeout = 15_000;

type UpdateManifest = {
  webVersion: string;
  bundleUrl: string;
  sha256: string;
  minimumNativeVersionCode: number;
};

export type LiveUpdateState =
  | { status: "idle" }
  | { status: "downloading"; version: string }
  | { status: "ready"; version: string; bundleId: string }
  | { status: "applying"; version: string; bundleId: string }
  | { status: "error"; version?: string; message: string };

let liveUpdateState: LiveUpdateState = { status: "idle" };
let initialized = false;
let activeCheck: Promise<void> | null = null;
const stateListeners = new Set<() => void>();

export function initializeLiveUpdates() {
  if (!Capacitor.isNativePlatform() || initialized) return;
  initialized = true;

  void CapacitorUpdater.notifyAppReady()
    .then(() => requestLiveUpdateCheck())
    .catch((error: unknown) => {
      console.warn("Live update initialization failed", error);
      publishState({ status: "error", message: "暂时无法检查更新，请稍后重试。" });
    });
}

export function requestLiveUpdateCheck(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (activeCheck) return activeCheck;

  activeCheck = checkForLiveUpdate()
    .catch((error: unknown) => {
      console.warn("Live update check failed", error);
      const version = "version" in liveUpdateState ? liveUpdateState.version : undefined;
      publishState({ status: "error", version, message: "更新下载失败，请检查网络后重试。" });
    })
    .finally(() => {
      activeCheck = null;
    });
  return activeCheck;
}

export function subscribeLiveUpdate(listener: () => void) {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function getLiveUpdateState() {
  return liveUpdateState;
}

export function dismissLiveUpdate() {
  publishState({ status: "idle" });
}

export async function retryLiveUpdate() {
  await requestLiveUpdateCheck();
}

export async function applyLiveUpdate() {
  const state = liveUpdateState;
  if (state.status !== "ready") return;
  await applyBundle(state.version, state.bundleId);
}

async function applyBundle(version: string, bundleId: string) {
  publishState({ status: "applying", version, bundleId });
  try {
    // set() switches the downloaded bundle and reloads the WebView immediately.
    // A successful call destroys this JavaScript context, so no code belongs after it.
    await CapacitorUpdater.set({ id: bundleId });
  } catch (error) {
    console.warn("Live update activation failed", error);
    clearPendingBundle();
    publishState({ status: "error", version, message: "重启更新失败，请重新下载后再试。" });
  }
}

async function checkForLiveUpdate() {
  const backendURL = configuredBackendURL();
  if (!backendURL) {
    publishState({ status: "idle" });
    return;
  }

  const manifest = await fetchUpdateManifest(backendURL);
  if (!manifest) {
    publishState({ status: "idle" });
    return;
  }

  const [current, appInfo] = await Promise.all([
    CapacitorUpdater.current(),
    App.getInfo(),
  ]);
  const nativeVersionCode = Number(appInfo.build);
  if (!Number.isInteger(nativeVersionCode) || nativeVersionCode < manifest.minimumNativeVersionCode) {
    publishState({ status: "error", version: manifest.webVersion, message: "当前安装包版本过低，请先安装新版 App。" });
    return;
  }

  if (compareVersions(manifest.webVersion, current.bundle.version) <= 0) {
    clearPendingBundle();
    localStorage.removeItem(legacyQueuedVersionStorageKey);
    publishState({ status: "idle" });
    return;
  }

  const pendingVersion = localStorage.getItem(pendingVersionStorageKey);
  const pendingBundleId = localStorage.getItem(pendingBundleIDStorageKey);
  if (pendingVersion === manifest.webVersion && pendingBundleId) {
    publishState({ status: "ready", version: manifest.webVersion, bundleId: pendingBundleId });
    return;
  }

  publishState({ status: "downloading", version: manifest.webVersion });
  const bundleURL = new URL(manifest.bundleUrl, `${backendURL}/`).toString();
  const bundle = await CapacitorUpdater.download({
    url: bundleURL,
    version: manifest.webVersion,
    checksum: manifest.sha256,
  });
  localStorage.setItem(pendingVersionStorageKey, manifest.webVersion);
  localStorage.setItem(pendingBundleIDStorageKey, bundle.id);
  localStorage.removeItem(legacyQueuedVersionStorageKey);
  publishState({ status: "ready", version: manifest.webVersion, bundleId: bundle.id });
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

function clearPendingBundle() {
  localStorage.removeItem(pendingVersionStorageKey);
  localStorage.removeItem(pendingBundleIDStorageKey);
}

function publishState(state: LiveUpdateState) {
  liveUpdateState = state;
  stateListeners.forEach((listener) => listener());
}
