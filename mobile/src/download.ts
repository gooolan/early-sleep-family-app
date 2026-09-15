import { Capacitor, registerPlugin } from "@capacitor/core";

const BackupFiles = registerPlugin<{ save(options: { json: string; filename: string }): Promise<void> }>("BackupFiles");

export async function downloadJSON(value: unknown, name: string) {
  if (Capacitor.getPlatform() === "android") {
    if (!Capacitor.isPluginAvailable("BackupFiles")) throw new Error("请安装新版完整 APK 后导出，本机备份仍保留");
    await BackupFiles.save({ json: JSON.stringify(value, null, 2), filename: name });
    return;
  }
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
