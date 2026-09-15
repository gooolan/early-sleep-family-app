import { useState } from "react";
import { preserveLegacyCache } from "./backup";

export function ServerAddressForm({ backendURL }: { backendURL: string }) {
  const [address, setAddress] = useState(backendURL);
  const [error, setError] = useState("");
  function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const url = new URL(address.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("请输入完整的 http:// 或 https:// 服务器地址");
      }
      preserveLegacyCache();
      localStorage.setItem("earlySleep.backend", url.toString().replace(/\/$/, ""));
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof TypeError ? "服务器地址格式不正确" : reason instanceof Error ? reason.message : "地址未保存，请先导出本机备份");
    }
  }
  return <section className="card backup-card local-backups">
    <h2>更换服务器地址</h2>
    <p className="muted">无需退出家庭。本机备份和旧快照会保留；新服务器没有原家庭时，需要重新登录并恢复数据。</p>
    <form className="profile-form" onSubmit={save}>
      <label>服务器地址<input type="url" value={address} onChange={(event) => setAddress(event.target.value)} required placeholder="http://47.108.215.105:31080" /></label>
      {error && <div className="inline-error">{error}</div>}
      <button className="primary" type="submit" disabled={address.trim().replace(/\/$/, "") === backendURL.replace(/\/$/, "")}>保存地址并连接</button>
    </form>
  </section>;
}
