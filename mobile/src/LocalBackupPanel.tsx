import { downloadJSON } from "./download";
import { useEffect, useState } from "react";
import { backupChanged, backupStatus, listBackups, listLegacyCaches } from "./backup";

export function LocalBackupPanel({ backendURL, familyID }: { backendURL?: string; familyID?: string }) {
  const [, refresh] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    window.addEventListener(backupChanged, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(backupChanged, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  let backups: ReturnType<typeof listBackups> = [];
  let legacy: ReturnType<typeof listLegacyCaches> = [];
  let readError = "";
  try {
    backups = listBackups().filter((item) => !familyID || (item.latest.family.id === familyID && item.backendURL === backendURL?.replace(/\/$/, "")));
    legacy = familyID ? [] : listLegacyCaches();
  } catch { readError = "无法读取本地存储，请保留 App 数据后重试"; }

  async function download(value: unknown, name: string) {
    try { await downloadJSON(value, name); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "导出失败，请保留 App 数据后重试"); }
  }

  const syncError = backendURL ? backupStatus(backendURL) : "";
  return <section className="card backup-card local-backups">
    <div><span className="eyebrow">LOCAL BACKUP</span><h2>本机完整备份</h2></div>
    <p className="muted">联网同步后自动保存打卡、规则、周报、菜价和店铺等完整家庭数据；保留最近两份不同版本。断网或登录失效时仍可导出。</p>
    {!backups.length && <p className="muted">本机尚无完整备份，需要成功连接原家庭服务器后生成。</p>}
    {backups.map((item) => <div className="local-backup-entry" key={`${item.backendURL}:${item.latest.family.id}`}>
      <strong>{item.latest.family.name}</strong>
      <small>{item.backendURL} · {item.latest.family.id}</small>
      <small>备份时间：{new Date(item.latest.exportedAt).toLocaleString()}</small>
      <div className="local-backup-actions">
        <button className="primary" onClick={() => download(item.latest, `early-sleep-${item.latest.family.id}-${item.latest.exportedAt.replace(/[:.]/g, "-")}.json`)}>导出本机 JSON</button>
        {item.previous && <button className="ghost" onClick={() => download(item.previous, `early-sleep-${item.latest.family.id}-previous.json`)}>导出上一版</button>}
      </div>
    </div>)}
    {!!legacy.length && <div className="local-backup-entry"><strong>旧版早睡快照</strong><p className="muted">用于人工抢救打卡和周报，不包含菜价，不能直接通过“恢复备份”导入。</p>{legacy.map((item, index) => <button className="ghost" key={item.key} onClick={() => download({ format: "early-sleep-view-rescue", raw: item.raw }, `early-sleep-rescue-${index + 1}.json`)}>导出旧快照 {index + 1}</button>)}</div>}
    {(error || readError || syncError) && <div className="inline-error">{error || readError || syncError}</div>}
    <div className="backup-warning">卸载或清除 App 数据会删除本机备份。备份含手机号和家庭记录，请定期导出到可信位置。服务器家庭已丢失时，需用导出的文件在服务器端重建。</div>
  </section>;
}
