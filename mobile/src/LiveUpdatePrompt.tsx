import { useSyncExternalStore } from "react";
import {
  applyLiveUpdate,
  dismissLiveUpdate,
  getLiveUpdateState,
  retryLiveUpdate,
  subscribeLiveUpdate,
} from "./updater";

export function LiveUpdatePrompt() {
  const update = useSyncExternalStore(subscribeLiveUpdate, getLiveUpdateState, getLiveUpdateState);
  if (update.status === "idle") return null;

  const downloading = update.status === "downloading";
  const ready = update.status === "ready";
  const applying = update.status === "applying";
  const failed = update.status === "error";
  const version = "version" in update ? update.version : undefined;

  return (
    <div className="live-update-overlay" role="dialog" aria-modal="true" aria-labelledby="live-update-title">
      <section className="live-update-dialog">
        <div className={`live-update-mark ${failed ? "failed" : ""}`} aria-hidden="true">
          {failed ? "!" : ready ? "✓" : "↻"}
        </div>
        <span className="eyebrow">APP UPDATE{version ? ` · ${version}` : ""}</span>
        <h2 id="live-update-title">{downloading ? "发现新版本" : ready ? "更新已经准备好" : applying ? "正在重启应用" : "更新没有完成"}</h2>
        <p>{downloading ? "正在下载最新资源，请稍候。下载完成后由你决定何时重启。" : ready ? "点击下面的按钮，应用会立即重新加载并切换到新版本。" : applying ? "正在切换版本，请不要关闭应用。" : update.message}</p>
        {(downloading || applying) && <div className="live-update-progress"><i /></div>}
        {ready && <div className="live-update-actions"><button className="primary" onClick={() => void applyLiveUpdate()}>立即重启并更新</button><button className="ghost" onClick={dismissLiveUpdate}>稍后</button></div>}
        {failed && <div className="live-update-actions"><button className="primary" onClick={() => void retryLiveUpdate()}>重试</button><button className="ghost" onClick={dismissLiveUpdate}>继续使用</button></div>}
      </section>
    </div>
  );
}
