import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { APIClient, APIError } from "./api";
import { PriceView } from "./PriceView";
import type { Archive, DayResult, Family, FamilyBackup, Member, PendingChange, PendingExemption, RuleTier, Settings, WeekSummary } from "./types";
import { requestLiveUpdateCheck } from "./updater";

type Tab = "home" | "records" | "prices" | "archives" | "settings";
type SettingsSection = "root" | "profile" | "score" | "reward" | "levels" | "review" | "backup";
type SetupMode = "create" | "join";
type SyncState = "syncing" | "synced" | "offline";

const storage = {
  backend: "earlySleep.backend",
  token: "earlySleep.token",
  phone: "earlySleep.phone",
  joinCode: "earlySleep.joinCode",
  family: "earlySleep.family.v1",
};

const configuredBackend = import.meta.env.VITE_API_BASE_URL ?? "";

type FamilyCache = {
  version: 1;
  backendURL: string;
  family: Family;
};

function normalizedBackend(value: string) {
  return value.replace(/\/$/, "");
}

function readCachedFamily(backendURL: string): Family | null {
  try {
    const raw = localStorage.getItem(storage.family);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<FamilyCache>;
    if (
      cached.version !== 1
      || normalizedBackend(cached.backendURL ?? "") !== normalizedBackend(backendURL)
      || !cached.family?.id
      || !cached.family.currentMember?.id
      || !cached.family.activeWeek?.weekStart
    ) return null;
    return cached.family;
  } catch {
    localStorage.removeItem(storage.family);
    return null;
  }
}

function writeCachedFamily(backendURL: string, family: Family) {
  const cached: FamilyCache = {
    version: 1,
    backendURL: normalizedBackend(backendURL),
    family,
  };
  try {
    localStorage.setItem(storage.family, JSON.stringify(cached));
  } catch {
    // The server remains the source of truth if the WebView storage quota is full.
  }
}

const v3PersonalRewardTiers = [
  { minimum: 10, range: "10～14 分", added: 20, total: 20 },
  { minimum: 15, range: "15～19 分", added: 20, total: 40 },
  { minimum: 20, range: "20～22 分", added: 30, total: 70 },
  { minimum: 23, range: "23～25 分", added: 30, total: 100 },
] as const;

const v3FamilyRewardTiers = [
  { minimum: 20, range: "20～29 分", added: 20, total: 20 },
  { minimum: 30, range: "30～39 分", added: 20, total: 40 },
  { minimum: 40, range: "40～45 分", added: 30, total: 70 },
  { minimum: 46, range: "46～50 分", added: 30, total: 100 },
] as const;

const personalRewardTiers = [
  { minimum: 5, range: "5～9.9 分", added: 20, total: 20 },
  { minimum: 10, range: "10～14.9 分", added: 20, total: 40 },
  { minimum: 15, range: "15～19.9 分", added: 30, total: 70 },
  { minimum: 20, range: "20 分及以上", added: 30, total: 100 },
] as const;

const familyRewardTiers = [
  { minimum: 10, range: "10～19.9 分", added: 20, total: 20 },
  { minimum: 20, range: "20～29.9 分", added: 20, total: 40 },
  { minimum: 30, range: "30～39.9 分", added: 30, total: 70 },
  { minimum: 40, range: "40 分及以上", added: 30, total: 100 },
] as const;

const rewardRuleVersions = {
  v3: { personal: v3PersonalRewardTiers, family: v3FamilyRewardTiers, personalMinimum: 10, minimumCheckinDays: 0 },
  v4: { personal: personalRewardTiers, family: familyRewardTiers, personalMinimum: 5, minimumCheckinDays: 5 },
} as const;

function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function messageOf(error: unknown) {
  return error instanceof APIError || error instanceof Error ? error.message : "操作失败，请稍后再试";
}

export default function App() {
  const [backendURL, setBackendURL] = useState(localStorage.getItem(storage.backend) ?? configuredBackend);
  const [token, setToken] = useState(localStorage.getItem(storage.token) ?? "");
  const [joinCode, setJoinCode] = useState(localStorage.getItem(storage.joinCode) ?? "");
  const [family, setFamily] = useState<Family | null>(() => token ? readCachedFamily(backendURL) : null);
  const [tab, setTab] = useState<Tab>("home");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("root");
  const tabRef = useRef(tab);
  const settingsSectionRef = useRef(settingsSection);
  const [loading, setLoading] = useState(Boolean(token));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [startupRetry, setStartupRetry] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>(token ? "syncing" : "offline");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const client = useMemo(() => new APIClient(backendURL, token), [backendURL, token]);
  tabRef.current = tab;
  settingsSectionRef.current = settingsSection;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    setSyncState("syncing");
    client.family().then(acceptFamily).catch((reason) => {
      setSyncState("offline");
      setError(messageOf(reason));
      if (reason instanceof APIError && reason.code === "unauthorized") clearSession();
    }).finally(() => setLoading(false));
  }, [client, token, startupRetry]);

  useEffect(() => {
    if (!token) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      setSyncState("syncing");
      client.family().then(acceptFamily).catch(() => setSyncState("offline"));
    };
    const interval = window.setInterval(refresh, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onOffline = () => setSyncState("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", onOffline);
    };
  }, [client, token]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const listener = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      if (tabRef.current === "settings" && settingsSectionRef.current !== "root") {
        setSettingsSection("root");
        return;
      }
      if (canGoBack) {
        window.history.back();
        return;
      }
      void CapacitorApp.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  function acceptFamily(nextFamily: Family) {
    setFamily(nextFamily);
    writeCachedFamily(backendURL, nextFamily);
    setLastSyncedAt(new Date());
    setSyncState("synced");
  }

  function saveSession(nextToken: string, nextFamily: Family, nextJoinCode = "") {
    localStorage.setItem(storage.backend, backendURL.replace(/\/$/, ""));
    localStorage.setItem(storage.token, nextToken);
    if (nextFamily.currentMember.phone) localStorage.setItem(storage.phone, nextFamily.currentMember.phone);
    if (nextJoinCode) localStorage.setItem(storage.joinCode, nextJoinCode);
    else localStorage.removeItem(storage.joinCode);
    setToken(nextToken);
    setJoinCode(nextJoinCode);
    acceptFamily(nextFamily);
    setError("");
    void requestLiveUpdateCheck();
  }

  function clearSession() {
    localStorage.removeItem(storage.token);
    localStorage.removeItem(storage.phone);
    localStorage.removeItem(storage.joinCode);
    localStorage.removeItem(storage.family);
    setToken("");
    setJoinCode("");
    setFamily(null);
    setSettingsSection("root");
    setLastSyncedAt(null);
    setSyncState("offline");
  }

  function changeTab(nextTab: Tab) {
    setSettingsSection("root");
    setTab(nextTab);
  }

  async function run(action: () => Promise<Family>, success: string) {
    setLoading(true);
    setError("");
    setSyncState("syncing");
    try {
      acceptFamily(await action());
      setNotice(success);
      window.setTimeout(() => setNotice(""), 2200);
    } catch (reason) {
      setError(messageOf(reason));
      setSyncState(reason instanceof APIError && reason.code === "network_error" ? "offline" : lastSyncedAt ? "synced" : "offline");
    } finally {
      setLoading(false);
    }
  }

  async function exportBackup() {
    setLoading(true);
    setError("");
    try {
      const backup = await client.exportFamily();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `early-sleep-${family?.id ?? "family"}-${localToday()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("家庭备份已导出，请妥善保存");
      window.setTimeout(() => setNotice(""), 2200);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Setup
        backendURL={backendURL}
        setBackendURL={setBackendURL}
        loading={loading}
        error={error}
        onError={setError}
        onLoading={setLoading}
        onSession={saveSession}
      />
    );
  }

  if (!family) {
    return (
      <Startup
        backendURL={backendURL}
        loading={loading}
        error={error}
        onRetry={() => setStartupRetry((value) => value + 1)}
        onReset={clearSession}
      />
    );
  }

  const reviewCount = [
    ...(family.pendingChanges ?? []),
    ...(family.pendingExemptions ?? []),
  ].filter((change) => change.requestedBy !== family.currentMember.id).length;
  const approvalMessage = family.members.length > 1 ? "已发送给对方确认，确认后才会重新计分" : "记录已保存并重新计分";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">{family.activeWeek.weekStart} — {family.activeWeek.weekEnd}</span>
          <h1>{family.name}</h1>
        </div>
        <div className="topbar-profile"><SyncIndicator state={syncState} lastSyncedAt={lastSyncedAt} /><div className="avatar">{family.currentMember.name.slice(0, 1)}</div></div>
      </header>

      <main>
        {notice && <div className="toast success">{notice}</div>}
        {error && <div className="toast error">{error}<button onClick={() => setError("")}>×</button></div>}
        {tab === "home" && <Home family={family} loading={loading} onCheckIn={() => run(() => client.checkInNow(), "今晚打卡成功")} />}
        {tab === "records" && <Records family={family} loading={loading} onCheckIn={() => run(() => client.checkInNow(), "今晚打卡成功")} onSave={(date, time) => run(() => client.saveCheckin(date, time), approvalMessage)} onReview={(id, approve) => run(() => client.reviewCheckinChange(id, approve), approve ? "修改已确认，本周分数已更新" : "修改已拒绝")} onCancel={(id) => run(() => client.cancelCheckinChange(id), "修改申请已撤回")} onExempt={(date) => run(() => client.requestExemption(date), family.members.length > 1 ? "豁免申请已发送给对方确认" : "本日已豁免")} onReviewExemption={(id, approve) => run(() => client.reviewExemptionChange(id, approve), approve ? "豁免已确认，本日记为 0 分、0 罚金" : "豁免申请已拒绝")} onCancelExemption={(id) => run(() => client.cancelExemptionChange(id), "豁免申请已撤回")} />}
        {tab === "prices" && <PriceView client={client} family={family} />}
        {tab === "archives" && <WeeklyReports family={family} />}
        {tab === "settings" && <SettingsView family={family} backendURL={backendURL} joinCode={joinCode} loading={loading} section={settingsSection} onSectionChange={setSettingsSection} onSaveProfile={(name) => run(() => client.saveProfile(name), "个人信息已更新")} onSave={(settings) => run(() => client.saveSettings(settings), "本周设置已保存")} onCompleteReview={() => run(() => client.completeRewardReview(), "已完成本轮 30 天规则复盘")} onExport={exportBackup} onRestore={(backup) => run(() => client.restoreFamily(backup), "家庭数据已从备份恢复")} onExit={clearSession} />}
      </main>

      <nav className="bottom-nav">
        <NavButton active={tab === "home"} label="今天" icon="☾" onClick={() => changeTab("home")} />
        <NavButton active={tab === "records"} label="记录" icon="✓" badge={reviewCount} onClick={() => changeTab("records")} />
        <NavButton active={tab === "prices"} label="菜价" icon="⌕" onClick={() => changeTab("prices")} />
        <NavButton active={tab === "archives"} label="周报" icon="▥" onClick={() => changeTab("archives")} />
        <NavButton active={tab === "settings"} label="设置" icon="⚙" onClick={() => changeTab("settings")} />
      </nav>
      {loading && <div className="loading-line" />}
    </div>
  );
}

function Startup({ backendURL, loading, error, onRetry, onReset }: { backendURL: string; loading: boolean; error: string; onRetry: () => void; onReset: () => void }) {
  return (
    <div className="startup-page">
      <div className="moon-mark"><span>☾</span></div>
      <p className="eyebrow">TWO PEOPLE · ONE SMALL PROMISE</p>
      <h1>一起早点睡</h1>
      {!error ? (
        <div className="startup-status"><i /><span>正在恢复你们的早睡计划…</span></div>
      ) : (
        <div className="startup-error">
          <strong>暂时无法恢复数据</strong>
          <p>{error}</p>
          <small>{backendURL || "尚未配置后端地址"}</small>
          <button className="primary wide" disabled={loading} onClick={onRetry}>{loading ? "正在重试…" : "重新连接"}</button>
          <button className="startup-reset" disabled={loading} onClick={onReset}>返回登录与服务器设置</button>
        </div>
      )}
    </div>
  );
}

function Setup(props: {
  backendURL: string;
  setBackendURL: (value: string) => void;
  loading: boolean;
  error: string;
  onError: (value: string) => void;
  onLoading: (value: boolean) => void;
  onSession: (token: string, family: Family, joinCode?: string) => void;
}) {
  const [mode, setMode] = useState<SetupMode>("create");
  const [familyName, setFamilyName] = useState("我们的早睡计划");
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [phone, setPhone] = useState(localStorage.getItem(storage.phone) ?? "");
  const [pingState, setPingState] = useState("");
  const [newUser, setNewUser] = useState(false);

  async function ping() {
    props.onLoading(true);
    props.onError("");
    try {
      const result = await new APIClient(props.backendURL).ping();
      setPingState(result === "pong" ? "连接正常" : result);
      localStorage.setItem(storage.backend, props.backendURL.replace(/\/$/, ""));
    } catch (reason) {
      setPingState("");
      props.onError(messageOf(reason));
    } finally {
      props.onLoading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    props.onLoading(true);
    props.onError("");
    try {
      const api = new APIClient(props.backendURL);
      const session = mode === "create"
        ? await api.createFamily({ familyName, nickname, phone, timezone: "Asia/Shanghai" })
        : await api.joinFamily({ joinCode, nickname, phone });
      props.onSession(session.token, session.family, session.joinCode);
    } catch (reason) {
      props.onError(messageOf(reason));
    } finally {
      props.onLoading(false);
    }
  }

  async function identify(event: React.FormEvent) {
    event.preventDefault();
    props.onLoading(true);
    props.onError("");
    try {
      const api = new APIClient(props.backendURL);
      const pong = await api.ping();
      if (pong !== "pong") throw new APIError("invalid_server", "后端健康检查未通过");
      localStorage.setItem(storage.backend, props.backendURL.replace(/\/$/, ""));
      setPingState("连接正常");
      const status = await api.identify(phone);
      setPhone(status.phone);
      if (status.exists) {
        const session = await api.login(status.phone);
        props.onSession(session.token, session.family, session.joinCode);
        return;
      }
      setNewUser(true);
    } catch (reason) {
      props.onError(messageOf(reason));
    } finally {
      props.onLoading(false);
    }
  }

  return (
    <div className="setup-page">
      <div className="moon-mark"><span>☾</span></div>
      <p className="eyebrow">TWO PEOPLE · ONE SMALL PROMISE</p>
      <h1>一起早点睡</h1>
      <p className="intro">手机号作为稳定身份 ID。重新安装后，配置同一服务器并输入原手机号即可恢复家庭。</p>

      <section className="setup-card">
        <label>后端地址</label>
        <div className="inline-field">
          <input value={props.backendURL} onChange={(event) => { props.setBackendURL(event.target.value); setNewUser(false); }} placeholder="http://192.168.1.10:8080" />
          <button type="button" className="ghost small" onClick={ping} disabled={props.loading || !props.backendURL}>测试</button>
        </div>
        <p className={pingState ? "connection good" : "connection"}>{pingState || "真机请填写电脑或服务器可访问的地址"}</p>

        {!newUser ? (
          <form onSubmit={identify}>
            <label>手机号 / 用户 ID<input className="phone-input" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required maxLength={24} placeholder="例如 13800138000" /></label>
            {props.error && <div className="form-error">{props.error}</div>}
            <button className="primary wide" disabled={props.loading || !props.backendURL}>{props.loading ? "正在识别…" : "继续"}</button>
            <p className="trusted-auth">当前私人版本暂不验证短信验证码；部署到公网前应启用验证码。</p>
          </form>
        ) : (
          <>
            <div className="identity-found"><span>新用户</span><strong>{phone}</strong><button onClick={() => setNewUser(false)}>修改</button></div>
            <div className="segment">
              <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>新建家庭</button>
              <button type="button" className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>加入家庭</button>
            </div>
            <form onSubmit={submit}>
              {mode === "create" ? (
                <label>家庭名称<input value={familyName} onChange={(event) => setFamilyName(event.target.value)} required maxLength={30} /></label>
              ) : (
                <label>家庭邀请码<input className="code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} required maxLength={16} placeholder="例如 AB12CD34" /></label>
              )}
              <label>你的称呼<input value={nickname} onChange={(event) => setNickname(event.target.value)} required maxLength={20} placeholder="例如 小兰" /></label>
              {props.error && <div className="form-error">{props.error}</div>}
              <button className="primary wide" disabled={props.loading}>{props.loading ? "正在连接…" : mode === "create" ? "用推荐规则开始" : "加入家庭"}</button>
            </form>
          </>
        )}
      </section>
      <p className="footnote">推荐规则创建后仍可修改；修改会重算本周，历史周不受影响。</p>
    </div>
  );
}

function Home({ family, loading, onCheckIn }: { family: Family; loading: boolean; onCheckIn: () => void }) {
  const me = family.currentMember;
  const mySummary = family.activeWeek.summary.members[me.id] ?? { totalScore: 0, totalFine: 0, checkinDays: 0, averageSleepTime: "--:--" };
  const latest = [...(family.activeWeek.days ?? [])].reverse().find((day) => day.members[me.id]);
  const weekDays = dateRange(family.activeWeek.weekStart, family.activeWeek.weekEnd).length;
  const personalMaximum = weeklyMaximum(family.activeWeek.settings, family.activeWeek.weekStart, family.activeWeek.weekEnd);
  const familyScore = family.members.reduce((total, member) => total + (family.activeWeek.summary.members[member.id]?.totalScore ?? 0), 0);
  const familyLevel = scoreLevel(familyScore, personalMaximum * family.members.length);
  const personalLevel = scoreLevel(mySummary.totalScore, personalMaximum);
  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="stars">✦　·　✧</div>
        <span className="eyebrow light">今晚的约定</span>
        <div className="ideal-time">{family.activeWeek.settings.idealTime}</div>
        <p>理想入睡时间</p>
        <button className="checkin-button" onClick={onCheckIn} disabled={loading}>记录现在时间</button>
        <span className="hint">凌晨 {family.activeWeek.settings.cutoffHour}:00 前会算作前一天晚上</span>
      </section>

      {latest && <div className="latest-row"><span>最近一次 · {latest.date}</span><strong>{latest.members[me.id].exempt ? "已豁免　0 分" : `${latest.members[me.id].time}　${scoreText(latest.members[me.id].score)}`}</strong></div>}

      <section className="score-board">
        <ScorePanel label="双人本周总分" score={familyScore} level={familyLevel} icon="✦" />
        <ScorePanel label="我的本周分值" score={mySummary.totalScore} level={personalLevel} icon="☾" />
      </section>

      <section className="stats-grid">
        <Stat label="本周罚金" value={String(mySummary.totalFine)} suffix="元" />
        <Stat label="打卡天数" value={String(mySummary.checkinDays)} suffix={`/ ${weekDays}`} />
        <Stat label="平均入睡" value={mySummary.averageSleepTime || "--:--"} />
        <Stat label="家庭完成度" value={String(family.activeWeek.summary.completionRate)} suffix="%" />
      </section>

      <section className="card">
        <div className="section-title"><div><span className="eyebrow">THIS WEEK</span><h2>两个人的进度</h2></div><strong>{family.activeWeek.summary.completionRate}%</strong></div>
        <div className="progress"><span style={{ width: `${family.activeWeek.summary.completionRate}%` }} /></div>
        <div className="member-summaries">
          {family.members.map((member) => {
            const summary = family.activeWeek.summary.members[member.id];
            const level = scoreLevel(summary?.totalScore ?? 0, personalMaximum);
            return <div key={member.id}><span className="mini-avatar">{member.name.slice(0, 1)}</span><span>{member.name}</span><ScoreTag score={summary?.totalScore ?? 0} level={level} /></div>;
          })}
        </div>
      </section>
    </div>
  );
}

function Records({ family, loading, onCheckIn, onSave, onReview, onCancel, onExempt, onReviewExemption, onCancelExemption }: { family: Family; loading: boolean; onCheckIn: () => void; onSave: (date: string, time: string) => void; onReview: (id: string, approve: boolean) => void; onCancel: (id: string) => void; onExempt: (date: string) => void; onReviewExemption: (id: string, approve: boolean) => void; onCancelExemption: (id: string) => void }) {
  const [editor, setEditor] = useState<{ date: string; time: string; hasRecord: boolean } | null>(null);
  const me = family.currentMember;
  const days = dateRange(family.activeWeek.weekStart, family.activeWeek.weekEnd);
  const pending = family.pendingChanges ?? [];
  const incoming = pending.filter((change) => change.requestedBy !== me.id);
  const outgoing = pending.filter((change) => change.requestedBy === me.id);
  const exemptions = family.pendingExemptions ?? [];
  const incomingExemptions = exemptions.filter((change) => change.requestedBy !== me.id);
  const outgoingExemptions = exemptions.filter((change) => change.requestedBy === me.id);
  const exemptionUsage = monthlyExemptionUsage(family);
  const reachedDate = currentNightDate(family.timezone, family.activeWeek.settings.cutoffHour);

  function openEditor(day: string, value?: string) {
    setEditor({ date: day, time: nearestFiveMinutes(value ?? "23:00"), hasRecord: Boolean(value) });
  }

  return (
    <div className="page-stack">
      <section className="card exemption-budget">
        <div className="section-title"><div><span className="eyebrow">MONTHLY EXEMPTION</span><h2>本月特殊情况豁免</h2></div><span className="quota-month">{exemptionUsage.month.slice(5)} 月</span></div>
        <div className="quota-members">
          {family.members.map((member, index) => {
            const usage = exemptionUsage.members[member.id] ?? { approved: 0, pending: 0, remaining: 2 };
            return <div key={member.id}><i style={{ background: memberColor(index) }} /><span><b>{member.name}</b><small>已通过 {usage.approved} 次{usage.pending > 0 ? ` · 待确认 ${usage.pending} 次` : ""}</small></span><strong>剩余 {usage.remaining}/2</strong></div>;
          })}
        </div>
        <small className="quota-note">待确认申请也会预占额度；拒绝后额度自动恢复。</small>
      </section>
      {(incoming.length > 0 || outgoing.length > 0 || incomingExemptions.length > 0 || outgoingExemptions.length > 0) && (
        <section className="approval-center">
          <div className="section-title"><div><span className="eyebrow">CHECK TOGETHER</span><h2>双人确认</h2></div><span className="notification-count">{pending.length + exemptions.length}</span></div>
          {incoming.map((change) => <ApprovalItem key={change.id} change={change} members={family.members} canReview loading={loading} onReview={onReview} />)}
          {outgoing.map((change) => <ApprovalItem key={change.id} change={change} members={family.members} canReview={false} loading={loading} onReview={onReview} onCancel={onCancel} />)}
          {incomingExemptions.map((change) => <ExemptionApprovalItem key={change.id} change={change} members={family.members} canReview loading={loading} onReview={onReviewExemption} />)}
          {outgoingExemptions.map((change) => <ExemptionApprovalItem key={change.id} change={change} members={family.members} canReview={false} loading={loading} onReview={onReviewExemption} onCancel={onCancelExemption} />)}
        </section>
      )}

      <section className="card records-card">
        <div className="section-title"><div><span className="eyebrow">DAILY LOG</span><h2>本周记录</h2></div><span className="muted small-copy">编辑需对方确认</span></div>
        <div className="day-list">
          {days.map((day) => {
            const result = (family.activeWeek.days ?? []).find((item) => item.date === day);
            const mine = result?.members[me.id];
            const myPending = pending.find((change) => change.memberId === me.id && change.date === day);
            const myExemptionPending = exemptions.find((change) => change.memberId === me.id && change.date === day);
            const future = day > reachedDate;
            return (
              <div className="day-row" key={day}>
                <div className="date-badge"><strong>{new Date(`${day}T12:00:00`).getDate()}</strong><span>{weekday(day)}</span></div>
                <div className="day-members">
                  {family.members.map((member, memberIndex) => {
                    const record = result?.members[member.id];
                    const change = pending.find((candidate) => candidate.memberId === member.id && candidate.date === day);
                    return (
                      <div key={member.id} className="member-record">
                        <i style={{ background: memberColor(memberIndex) }} />
                        <span>{member.name}</span>
                        <strong className={record?.exempt ? "exempt-label" : ""}>{record ? record.exempt ? "已豁免" : record.time : "未打卡"}</strong>
                        {record && <em className={record.score >= 0 ? "positive" : "negative"}>{scoreText(record.score)}</em>}
                        {change && <small>{change.originalTime || "补卡"} → {change.proposedTime} · 待确认</small>}
                        {exemptions.find((candidate) => candidate.memberId === member.id && candidate.date === day) && <small>特殊情况豁免 · 待确认</small>}
                      </div>
                    );
                  })}
                </div>
                <div className="row-actions">
                  {!future && <button className={myPending || myExemptionPending ? "pending-button" : ""} onClick={() => day === reachedDate && !mine && !myPending && !myExemptionPending ? onCheckIn() : openEditor(day, mine?.exempt ? undefined : mine?.time)} disabled={loading || Boolean(mine?.exempt)}>{mine?.exempt ? "已豁免" : myExemptionPending ? "豁免待确认" : myPending ? "修改申请" : mine ? "编辑" : day === reachedDate ? "打卡" : "补卡"}</button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {editor && <EditSheet editor={editor} loading={loading} onClose={() => setEditor(null)} onSave={(date, time) => { onSave(date, time); setEditor(null); }} onExempt={(date) => { onExempt(date); setEditor(null); }} />}
    </div>
  );
}

function ExemptionApprovalItem({ change, members, canReview, loading, onReview, onCancel }: { change: PendingExemption; members: Member[]; canReview: boolean; loading: boolean; onReview: (id: string, approve: boolean) => void; onCancel?: (id: string) => void }) {
  const requester = members.find((member) => member.id === change.requestedBy);
  return (
    <div className="approval-item exemption-approval">
      <span className="approval-icon">○</span>
      <div><strong>{requester?.name ?? "对方"} · {formatDate(change.date)}</strong><p>申请特殊情况豁免：0 分、0 罚金</p></div>
      {canReview ? <div className="approval-actions"><button disabled={loading} onClick={() => onReview(change.id, false)}>拒绝</button><button className="approve" disabled={loading} onClick={() => onReview(change.id, true)}>同意</button></div> : <button className="cancel-pill" disabled={loading} onClick={() => onCancel?.(change.id)}>撤回</button>}
    </div>
  );
}

function ApprovalItem({ change, members, canReview, loading, onReview, onCancel }: { change: PendingChange; members: Member[]; canReview: boolean; loading: boolean; onReview: (id: string, approve: boolean) => void; onCancel?: (id: string) => void }) {
  const requester = members.find((member) => member.id === change.requestedBy);
  return (
    <div className="approval-item">
      <span className="approval-icon">↻</span>
      <div><strong>{requester?.name ?? "对方"} · {formatDate(change.date)}</strong><p>{change.originalTime || "未打卡"} → {change.proposedTime}</p></div>
      {canReview ? <div className="approval-actions"><button disabled={loading} onClick={() => onReview(change.id, false)}>拒绝</button><button className="approve" disabled={loading} onClick={() => onReview(change.id, true)}>同意</button></div> : <button className="cancel-pill" disabled={loading} onClick={() => onCancel?.(change.id)}>撤回</button>}
    </div>
  );
}

function EditSheet({ editor, loading, onClose, onSave, onExempt }: { editor: { date: string; time: string; hasRecord: boolean }; loading: boolean; onClose: () => void; onSave: (date: string, time: string) => void; onExempt: (date: string) => void }) {
  const [hour, setHour] = useState(editor.time.slice(0, 2));
  const [minute, setMinute] = useState(editor.time.slice(3, 5));
  const hours = [...Array.from({ length: 6 }, (_, index) => index + 18), ...Array.from({ length: 18 }, (_, index) => index)];
  const minutes = Array.from({ length: 12 }, (_, index) => index * 5);
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="edit-sheet" role="dialog" aria-modal="true" aria-label="编辑入睡时间">
        <div className="sheet-handle" />
        <div className="sheet-title"><div><span className="eyebrow">SLEEP TIME</span><h2>{editor.hasRecord ? "修改打卡" : "补充打卡"}</h2></div><button onClick={onClose} aria-label="关闭">×</button></div>
        <div className="selected-date"><span>日期</span><strong>{formatDate(editor.date)} · {weekday(editor.date)}</strong></div>
        <div className="time-picker">
          <label>时<select value={hour} onChange={(event) => setHour(event.target.value)}>{hours.map((value) => <option key={value} value={String(value).padStart(2, "0")}>{String(value).padStart(2, "0")}</option>)}</select></label>
          <b>:</b>
          <label>分<select value={minute} onChange={(event) => setMinute(event.target.value)}>{minutes.map((value) => <option key={value} value={String(value).padStart(2, "0")}>{String(value).padStart(2, "0")}</option>)}</select></label>
        </div>
        <p className="approval-note">提交后会通知对方，对方同意后才会更新记录和本周分数。</p>
        <button className="primary wide" disabled={loading} onClick={() => onSave(editor.date, `${hour}:${minute}`)}>提交给对方确认</button>
        <button className="sheet-exempt" disabled={loading} onClick={() => onExempt(editor.date)}>申请本日特殊情况豁免</button>
        <small className="exemption-note">每人每月最多 2 次，需对方确认；通过后本日记为有效记录，但为 0 分、0 罚金且不计入平均入睡时间。</small>
      </section>
    </div>
  );
}

function WeeklyReports({ family }: { family: Family }) {
  const archives = family.weeklyArchives ?? [];
  const [expandedWeek, setExpandedWeek] = useState("");
  const previousWeek = archives.find((archive) => archive.weekEnd === addDateDays(family.activeWeek.weekStart, -1));
  return (
    <div className="page-stack">
      <div className="page-heading"><span className="eyebrow">WEEKLY RHYTHM</span><div className="page-heading-title"><h2>两个人的睡眠周报</h2></div><p>本周保留完整看板，历史周默认折叠。折线越靠上代表入睡越晚，目标线以下代表早于目标时间。</p></div>
      {previousWeek && <WeekComparison family={family} previous={previousWeek} />}
      <WeeklyCard title="本周进行中" weekStart={family.activeWeek.weekStart} weekEnd={family.activeWeek.weekEnd} rewardRuleVersion={family.activeWeek.rewardRuleVersion} days={family.activeWeek.days ?? []} summary={family.activeWeek.summary} settings={family.activeWeek.settings} members={family.members} current />
      {archives.length === 0 ? <Empty text="还没有历史周报，完成第一周后这里会自动出现。" /> : <section className="history-weeks"><div className="history-weeks-head"><div><span className="eyebrow">HISTORY</span><h2>历史周报</h2></div><small>{archives.length} 周</small></div>{archives.map((archive) => <HistoryWeek key={archive.weekStart} archive={archive} members={family.members} expanded={expandedWeek === archive.weekStart} onToggle={() => setExpandedWeek((current) => current === archive.weekStart ? "" : archive.weekStart)} />)}</section>}
    </div>
  );
}

function WeekComparison({ family, previous }: { family: Family; previous: Archive }) {
  const today = dateInTimezone(family.timezone, new Date());
  const currentEnd = today < family.activeWeek.weekStart ? family.activeWeek.weekStart : today > family.activeWeek.weekEnd ? family.activeWeek.weekEnd : today;
  const elapsedDays = Math.min(7, inclusiveDays(family.activeWeek.weekStart, currentEnd));
  const previousEnd = addDateDays(previous.weekStart, elapsedDays - 1);
  const current = comparisonMetrics((family.activeWeek.days ?? []).filter((day) => day.date <= currentEnd), family.members);
  const last = comparisonMetrics((previous.dailySnapshot ?? []).filter((day) => day.date <= previousEnd), family.members);
  if (current.validRecords === 0) return null;
  const scoreDifference = current.score - last.score;
  const timeDifference = current.averageMinutes !== null && last.averageMinutes !== null ? current.averageMinutes - last.averageMinutes : null;
  return (
    <section className="week-comparison">
      <div className="week-comparison-head"><div><span className="eyebrow">WEEK OVER WEEK</span><h3>较上周同期</h3></div><small>均比较前 {elapsedDays} 天</small></div>
      <div className="week-comparison-grid">
        <ComparisonStat label="双人积分" value={`${current.score > 0 ? "+" : ""}${formatScore(current.score)} 分`} detail={differenceText(scoreDifference, "分")} positive={scoreDifference >= 0} />
        <ComparisonStat label="平均入睡" value={current.averageTime} detail={timeDifference === null ? "上周同期记录不足" : Math.abs(timeDifference) <= 5 ? "与上周基本持平" : timeDifference < 0 ? `提前 ${Math.abs(timeDifference)} 分钟` : `推迟 ${timeDifference} 分钟`} positive={timeDifference !== null && timeDifference <= 0} />
      </div>
    </section>
  );
}

function ComparisonStat({ label, value, detail, positive }: { label: string; value: string; detail: string; positive: boolean }) {
  return <div><span>{label}</span><b>{value}</b><small className={positive ? "positive" : "negative"}>{detail}</small></div>;
}

function HistoryWeek({ archive, members, expanded, onToggle }: { archive: Archive; members: Member[]; expanded: boolean; onToggle: () => void }) {
  const familyScore = members.reduce((total, member) => total + (archive.summary.members[member.id]?.totalScore ?? 0), 0);
  const reward = weeklyReward(archive.summary, members, archive.rewardRuleVersion);
  const level = scoreLevel(familyScore, weeklyMaximum(archive.settingsSnapshot, archive.weekStart, archive.weekEnd) * members.length);
  return (
    <article className={`history-week ${expanded ? "expanded" : ""}`}>
      <button className="history-week-toggle" onClick={onToggle} aria-expanded={expanded}>
        <div className="history-week-date"><span>{archive.weekStart.slice(5)} — {archive.weekEnd.slice(5)}</span><small>{members.map((member) => `${member.name} ${formatScore(archive.summary.members[member.id]?.totalScore ?? 0)} 分`).join(" · ")}</small></div>
        <div className="history-week-numbers"><span><small>双人积分</small><b>{familyScore > 0 ? "+" : ""}{formatScore(familyScore)}</b></span><span><small>完成度</small><b>{archive.summary.completionRate}%</b></span><span><small>奖励参考</small><b>{reward.total} 元</b></span></div>
        <GradeBadge level={level} />
        <em>{expanded ? "⌃" : "⌄"}</em>
      </button>
      {expanded && <div className="history-week-detail"><WeeklyCard title="历史周详情" weekStart={archive.weekStart} weekEnd={archive.weekEnd} rewardRuleVersion={archive.rewardRuleVersion} days={archive.dailySnapshot ?? []} summary={archive.summary} settings={archive.settingsSnapshot} members={members} /></div>}
    </article>
  );
}

function WeeklyCard({ title, weekStart, weekEnd, rewardRuleVersion = "v4", days, summary, settings, members, current = false }: { title: string; weekStart: string; weekEnd: string; rewardRuleVersion?: string; days: DayResult[]; summary: WeekSummary; settings: Settings; members: Member[]; current?: boolean }) {
  const personalMaximum = weeklyMaximum(settings, weekStart, weekEnd);
  const familyScore = members.reduce((total, member) => total + (summary.members[member.id]?.totalScore ?? 0), 0);
  const familyLevel = scoreLevel(familyScore, personalMaximum * members.length);
  const reward = weeklyReward(summary, members, rewardRuleVersion);
  const familyRequirement = reward.minimumCheckinDays > 0 ? `需两人都记录 ${reward.minimumCheckinDays} 天且达到 ${formatScore(reward.personalMinimum)} 分` : `需两人都至少达到 ${formatScore(reward.personalMinimum)} 分`;
  return (
    <section className={`card weekly-card ${current ? "current" : ""}`}>
      <div className="report-head"><div><span>{title}</span><h3>{weekStart} — {weekEnd}</h3></div><GradeBadge level={familyLevel} /></div>
      <div className={`family-score grade-${familyLevel.tone}`}><span>双人总分</span><strong>{familyScore > 0 ? "+" : ""}{formatScore(familyScore)}</strong><em>分 · {familyLevel.name}</em></div>
      <SleepChart weekStart={weekStart} weekEnd={weekEnd} days={days} members={members} idealTime={settings.idealTime} />
      <div className="report-members">
        {members.map((member, index) => {
          const memberSummary = summary.members[member.id] ?? { totalScore: 0, totalFine: 0, checkinDays: 0, averageSleepTime: "--:--" };
          const level = scoreLevel(memberSummary.totalScore, personalMaximum);
          return <div key={member.id}><i style={{ background: memberColor(index) }} /><span>{member.name}<small>{memberSummary.checkinDays} 天 · 均值 {memberSummary.averageSleepTime || "--:--"}</small></span><ScoreTag score={memberSummary.totalScore} level={level} /><em>罚金 {memberSummary.totalFine} 元</em></div>;
        })}
      </div>
      <div className="weekly-reward-result">
        <div className="reward-result-head"><span>本周积分奖励参考</span><strong>{reward.total} 元</strong></div>
        <div className="reward-result-rows">
          {reward.personal.map((item) => <div key={item.member.id}><span>{item.member.name}的个人奖励<small>{item.eligible ? item.payer ? `由 ${item.payer.name} 转入` : "等待搭档加入" : item.recordedDays < reward.minimumCheckinDays ? `需记录 ${reward.minimumCheckinDays} 天 · 当前 ${item.recordedDays} 天` : `达到 ${formatScore(reward.personalMinimum)} 分解锁`}</small></span><b>{item.amount} 元</b></div>)}
          <div><span>双人累计奖励<small>{reward.familyEligible ? `合计 ${formatScore(reward.familyScore)} 分 · 双方各承担 ${reward.family / 2} 元` : familyRequirement}</small></span><b>{reward.family} 元</b></div>
        </div>
        <small className="reward-cap-note">奖励规则 {rewardRuleVersion.toUpperCase()} · 每周最高 300 元；罚金另行手工结算。</small>
      </div>
      <div className="completion-line"><span>共同完成度</span><div><i style={{ width: `${summary.completionRate}%` }} /></div><strong>{summary.completionRate}%</strong></div>
    </section>
  );
}

function SleepChart({ weekStart, weekEnd, days, members, idealTime }: { weekStart: string; weekEnd: string; days: DayResult[]; members: Member[]; idealTime: string }) {
  const dates = dateRange(weekStart, weekEnd);
  const width = 560;
  const height = 230;
  const left = 48;
  const right = 18;
  const top = 28;
  const bottom = 42;
  const minimum = 22 * 60;
  const maximum = 26 * 60;
  const x = (index: number) => left + index * ((width - left - right) / Math.max(1, dates.length - 1));
  const y = (time: string) => {
    const value = Math.min(maximum, Math.max(minimum, nightMinutes(time)));
    return top + ((maximum - value) / (maximum - minimum)) * (height - top - bottom);
  };
  const ticks = ["22:00", "23:00", "00:00", "01:00", "02:00"];
  return (
    <div className="sleep-chart-wrap">
      <div className="chart-legend">{members.map((member, index) => <span key={member.id}><i style={{ background: memberColor(index) }} />{member.name}</span>)}</div>
      <svg className="sleep-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每日入睡时间折线图">
        {ticks.map((tick) => { const position = y(tick); return <g key={tick}><line x1={left} x2={width - right} y1={position} y2={position} className="chart-grid" /><text x={left - 8} y={position + 4} textAnchor="end" className="chart-y-label">{tick}</text></g>; })}
        <line x1={left} x2={width - right} y1={y(idealTime)} y2={y(idealTime)} className="chart-goal" />
        <text x={width - right - 4} y={y(idealTime) - 6} textAnchor="end" className="chart-goal-label">目标 {idealTime}</text>
        {dates.map((date, index) => <text key={date} x={x(index)} y={height - 13} textAnchor="middle" className="chart-x-label">{weekday(date).slice(1)}</text>)}
        {members.map((member, memberIndex) => {
          const points = dates.map((date, index) => {
            const record = days.find((day) => day.date === date)?.members[member.id];
            return record && !record.exempt && record.time ? { date, time: record.time, x: x(index), y: y(record.time) } : null;
          });
          return <g key={member.id}>{points.map((point, index) => { const previous = index > 0 ? points[index - 1] : null; return point && <g key={point.date}>{previous && <line x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} stroke={memberColor(memberIndex)} className="chart-line" />}<circle cx={point.x} cy={point.y} r="5" fill={memberColor(memberIndex)} className="chart-point" /><text x={point.x} y={point.y - 9} textAnchor="middle" fill={memberColor(memberIndex)} className="chart-time">{point.time}</text></g>; })}</g>;
        })}
      </svg>
    </div>
  );
}

function SettingsView({ family, backendURL, joinCode, loading, section, onSectionChange, onSaveProfile, onSave, onCompleteReview, onExport, onRestore, onExit }: { family: Family; backendURL: string; joinCode: string; loading: boolean; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; onSaveProfile: (name: string) => void; onSave: (settings: Settings) => void; onCompleteReview: () => void; onExport: () => Promise<void>; onRestore: (backup: FamilyBackup) => void; onExit: () => void }) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(family.activeWeek.settings));
  const [draftError, setDraftError] = useState("");
  const owner = family.currentMember.role === "owner";

  useEffect(() => { setDraft(structuredClone(family.activeWeek.settings)); setDraftError(""); }, [family.activeWeek.settings]);

  function updateTier(kind: "weekdayTiers" | "weekendTiers", index: number, key: keyof RuleTier, value: string) {
    setDraft((current) => {
      const next = structuredClone(current);
      const tier = next[kind][index];
      if (key === "end") {
        if (!value) return current;
        tier.end = nearestFiveMinutes(value);
      }
      else tier[key] = Number(value);
      return next;
    });
  }

  function saveSettings() {
    const validation = validateSettingsDraft(draft);
    if (validation) {
      setDraftError(validation);
      return;
    }
    setDraftError("");
    onSave(draft);
  }

  if (section === "profile") {
    return <ProfileView member={family.currentMember} loading={loading} onSave={onSaveProfile} onBack={() => onSectionChange("root")} />;
  }

  if (section === "score") {
    return <div className="page-stack"><SettingsBack eyebrow={owner ? "OWNER SETTINGS" : "CURRENT RULES"} title="本周积分规则" onBack={() => onSectionChange("root")} /><section className={`card rules-card ${owner ? "" : "readonly"}`}><p className="muted">{owner ? "保存后立即用新规则重算本周；已归档周报不会改变。时间与分数是积分锚点，区间内按实际分钟平滑计算到一位小数；罚金仍按整档计算。" : "以下是家庭创建者设置的本周具体规则。时间与分数是积分锚点，区间内按实际分钟平滑计算；罚金仍按整档计算。仅创建者可以修改。"}</p><div className="two-fields"><label>理想入睡<input type="time" step="300" disabled={!owner} value={draft.idealTime} onChange={(event) => { if (event.target.value) setDraft({ ...draft, idealTime: nearestFiveMinutes(event.target.value) }); }} /></label><label>凌晨归属截止<input type="number" min="0" max="11" disabled={!owner} value={draft.cutoffHour} onChange={(event) => setDraft({ ...draft, cutoffHour: Number(event.target.value) })} /></label></div><TierEditor title="工作日（周日—周四晚）" tiers={draft.weekdayTiers} disabled={!owner} onChange={(index, key, value) => updateTier("weekdayTiers", index, key, value)} /><TierEditor title="周末（周五、周六晚）" tiers={draft.weekendTiers} disabled={!owner} onChange={(index, key, value) => updateTier("weekendTiers", index, key, value)} />{owner && draftError && <div className="inline-error">{draftError}</div>}{owner && <button className="primary wide" disabled={loading} onClick={saveSettings}>保存并重算本周</button>}</section></div>;
  }

  if (section === "reward") {
    return <RewardRulesView onBack={() => onSectionChange("root")} />;
  }

  if (section === "levels") {
    return <LevelRulesView settings={family.activeWeek.settings} memberCount={family.members.length} onBack={() => onSectionChange("root")} />;
  }

  if (section === "review") {
    return <ReviewView family={family} loading={loading} owner={owner} onCompleteReview={onCompleteReview} onBack={() => onSectionChange("root")} />;
  }

  if (section === "backup") {
    return <DataBackupView family={family} owner={owner} loading={loading} onExport={onExport} onRestore={onRestore} onBack={() => onSectionChange("root")} />;
  }

  const review = family.rewardReview;
  return <div className="page-stack"><section className="card info-card"><span className="eyebrow">FAMILY</span><h2>{family.name}</h2><dl><div><dt>当前成员</dt><dd>{family.currentMember.name} · {owner ? "创建者" : "成员"}</dd></div>{family.currentMember.phone && <div><dt>手机号 ID</dt><dd>{family.currentMember.phone}</dd></div>}<div><dt>后端地址</dt><dd>{backendURL}</dd></div>{joinCode && <div><dt>家庭邀请码</dt><dd className="join-code">{joinCode}</dd></div>}</dl><button className="profile-edit" onClick={() => onSectionChange("profile")}>修改个人信息 ›</button></section><section className={`card review-card ${review?.due ? "due" : ""}`}><div><span className="eyebrow">30-DAY REVIEW</span><h2>{review?.due ? "规则复盘已到期" : "30 天规则复盘"}</h2><p>{review?.due ? "一起回顾 30 天趋势、完成率、积分和罚金，再决定是否调整规则。" : `本周期已进行 ${30 - (review?.daysRemaining ?? 30)} 天，距离复盘还有 ${review?.daysRemaining ?? 30} 天。`}</p></div><button className="review-open" onClick={() => onSectionChange("review")}>查看数据 ›</button></section><section className="card settings-menu"><span className="eyebrow">RULES & GUIDE</span><h2>规则与说明</h2><p className="muted">两位成员都可以查看；App 仅计算奖励参考金额，实际转账由双方手工完成。</p>{!owner && <button onClick={() => onSectionChange("score")}><span className="settings-entry-icon">⌁</span><span><b>积分规则</b><small>查看本周理想时间、积分与罚金档位</small></span><em>›</em></button>}<button onClick={() => onSectionChange("reward")}><span className="settings-entry-icon reward">✦</span><span><b>奖励规则</b><small>个人奖励、双人累计奖励与付款方式</small></span><em>›</em></button><button onClick={() => onSectionChange("levels")}><span className="settings-entry-icon level">◐</span><span><b>等级说明</b><small>晨光、新芽、清风、守夜与重启</small></span><em>›</em></button></section><section className="card settings-menu"><span className="eyebrow">DATA</span><h2>数据管理</h2><p className="muted">导出完整家庭备份；只有创建者可以恢复。</p><button onClick={() => onSectionChange("backup")}><span className="settings-entry-icon data">⇩</span><span><b>导出与恢复</b><small>保存 JSON 备份或恢复同一家庭</small></span><em>›</em></button></section>{owner && <section className="card settings-menu"><span className="eyebrow">OWNER SETTINGS</span><h2>创建者设置</h2><p className="muted">修改积分档位只影响当前活动周。</p><button onClick={() => onSectionChange("score")}><span className="settings-entry-icon">⌁</span><span><b>编辑积分规则</b><small>理想时间、积分与罚金档位</small></span><em>›</em></button></section>}<button className="exit-button" onClick={onExit}>退出此家庭（仅清除本机凭证）</button></div>;
}

function ProfileView({ member, loading, onSave, onBack }: { member: Member; loading: boolean; onSave: (name: string) => void; onBack: () => void }) {
  const [name, setName] = useState(member.name);
  const [profileError, setProfileError] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setProfileError("请输入称呼");
      return;
    }
    setProfileError("");
    onSave(value);
  }

  return <div className="page-stack"><SettingsBack eyebrow="MY PROFILE" title="个人信息" onBack={onBack} /><section className="card profile-card"><div className="profile-avatar" aria-hidden="true">{(name.trim() || member.name).slice(0, 1)}</div><form className="profile-form" onSubmit={submit}><label>称呼<input autoComplete="nickname" maxLength={20} value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入你的称呼" /></label><label>手机号 ID<input className="readonly-field" value={member.phone ?? ""} readOnly /></label><small>手机号用于恢复身份，当前不可直接修改；头像会跟随称呼首字更新。</small>{profileError && <div className="inline-error">{profileError}</div>}<button className="primary wide" disabled={loading || name.trim() === member.name} type="submit">保存个人信息</button></form></section></div>;
}

function DataBackupView({ family, owner, loading, onExport, onRestore, onBack }: { family: Family; owner: boolean; loading: boolean; onExport: () => Promise<void>; onRestore: (backup: FamilyBackup) => void; onBack: () => void }) {
  const [backupError, setBackupError] = useState("");

  async function selectBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as FamilyBackup;
      if (!value || typeof value !== "object" || value.formatVersion !== 1 || !value.family) throw new Error("invalid backup");
      if (!window.confirm(`确认使用“${file.name}”覆盖当前家庭数据吗？恢复前建议先导出当前备份。`)) return;
      setBackupError("");
      onRestore(value);
    } catch {
      setBackupError("无法读取该备份，请选择由本 App 导出的 JSON 文件");
    }
  }

  return <div className="page-stack"><SettingsBack eyebrow="DATA BACKUP" title="导出与恢复" onBack={onBack} /><section className="card backup-card"><div className="backup-block"><BackupIcon kind="download" /><div><h3>导出家庭备份</h3><p>包含计分规则、打卡、豁免、周报和复盘周期，不包含可直接登录的成员令牌。</p></div><button className="primary" disabled={loading} onClick={() => void onExport()}>导出 JSON</button></div><div className="backup-warning">备份包含手机号和家庭记录，请存放在可信位置，不要发送给无关人员。</div></section><section className="card backup-card"><div className="backup-block"><BackupIcon kind="restore" /><div><h3>从备份恢复</h3><p>{owner ? "仅支持恢复同一个家庭、相同成员组成的备份；当前登录凭证会保留。" : "只有家庭创建者可以执行恢复。"}</p></div>{owner && <label className="restore-file"><input type="file" accept="application/json,.json" disabled={loading} onChange={(event) => void selectBackup(event)} /><span>选择备份文件</span></label>}</div>{backupError && <div className="inline-error">{backupError}</div>}<small>当前家庭：{family.name} · {family.id}</small></section></div>;
}

function BackupIcon({ kind }: { kind: "download" | "restore" }) {
  return <span className={`backup-icon ${kind === "restore" ? "restore" : ""}`} aria-hidden="true">{kind === "download" ? <svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14" /></svg> : <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8m0 0V3m0 5h5" /></svg>}</span>;
}

function ReviewView({ family, loading, owner, onCompleteReview, onBack }: { family: Family; loading: boolean; owner: boolean; onCompleteReview: () => void; onBack: () => void }) {
  const metrics = buildReviewMetrics(family);
  const review = family.rewardReview;
  return (
    <div className="page-stack">
      <SettingsBack eyebrow="30-DAY REVIEW" title="30 天规则复盘" onBack={onBack} />
      <section className="card review-overview">
        <div><span>本周期</span><strong className="review-period"><span>{metrics.start}</span>{metrics.start !== metrics.end && <span>至 {metrics.end}</span>}</strong><small>已统计 {metrics.elapsedDays} 天</small></div>
        <div><span>双人完成度</span><strong>{metrics.completionRate}%</strong><small>豁免按有效记录计算</small></div>
        <div><span>完整周奖励参考</span><strong>{metrics.rewardReference} 元</strong><small>{metrics.rewardWeeks} 个完整周，仍需手工结算</small></div>
      </section>
      {metrics.members.some((metric) => metric.validDays < 7) && <p className="review-data-note">至少积累 7 天有效记录后，平均时间和前后趋势会更有参考价值。</p>}
      <section className="review-member-list">
        {metrics.members.map((metric, index) => (
          <article className="card review-member" key={metric.member.id}>
            <div className="review-member-head"><i style={{ background: memberColor(index) }} /><div><h3>{metric.member.name}</h3><span>{metric.validDays}/{metrics.elapsedDays} 天有效记录 · 完成度 {metric.completionRate}%</span></div><strong>{metric.totalScore > 0 ? "+" : ""}{formatScore(metric.totalScore)} 分</strong></div>
            <div className="review-stat-grid"><span>平均入睡<b>{metric.averageTime}</b></span><span>累计罚金<b>{metric.totalFine} 元</b></span><span>使用豁免<b>{metric.exemptions} 次</b></span></div>
            <div className="review-trend"><span>首 7 天 <b>{metric.firstAverage}</b></span><i>→</i><span>最近 7 天 <b>{metric.lastAverage}</b></span><strong className={!metric.trendAvailable ? "" : metric.trendMinutes <= 0 ? "positive" : "negative"}>{reviewTrendText(metric)}</strong></div>
          </article>
        ))}
      </section>
      <section className="card review-checklist"><span className="eyebrow">TALK TOGETHER</span><h3>建议一起确认</h3><ul><li>平均入睡时间是否正在接近目标？</li><li>积分和罚金是否仍有激励作用，而不是形成压力？</li><li>每周最高 300 元的奖励预算是否合适？</li><li>豁免次数是否够用，是否被当成普通补卡使用？</li></ul><p>本页面只用于复盘规则，不生成账单或自动结算。</p></section>
      {review?.due && owner && <button className="primary wide" disabled={loading} onClick={onCompleteReview}>双方已复盘，开始新的 30 天周期</button>}
      {review?.due && !owner && <p className="review-owner-note">共同复盘完成后，由创建者开始新的 30 天周期。</p>}
    </div>
  );
}

function RewardRulesView({ onBack }: { onBack: () => void }) {
  return <div className="page-stack"><SettingsBack eyebrow="BUILT-IN REWARD" title="奖励计算规则" onBack={onBack} /><section className="card reward-rules-card"><p className="rule-intro">每周奖励由“个人奖励”和“双人累计奖励”组成。当周至少有 5 个有效记录日且累计 5 分，即可获得首档奖励；豁免日计入有效记录。合计最高 <b>300 元</b>。</p><RuleTable title="个人周奖励" caption="满足 5 个有效记录日后，个人奖励由对方转入共同账户，每人最高 100 元。" firstLabel="个人积分" rows={personalRewardTiers} zeroLabel="4.9 分及以下" /><RuleTable title="双人累计奖励" caption="需两人都记录至少 5 天且各获得 5 分；奖励由双方各承担 50%。" firstLabel="双人合计" rows={familyRewardTiers} zeroLabel="任一人未达个人门槛" /><div className="payment-rules"><div><b>个人奖励怎么付</b><span>A 的奖励由 B 付，B 的奖励由 A 付，都转入共同账户。</span></div><div><b>罚金不变</b><span>一人熬夜时罚金给对方；两人同时熬夜时各自转入共同账户。</span></div><div><b>300 元的口径</b><span>仅限积分奖励，不包含罚金；奖励与罚金不相互抵消。</span></div></div></section></div>;
}

function RuleTable({ title, caption, firstLabel, rows, zeroLabel }: { title: string; caption: string; firstLabel: string; rows: readonly { range: string; added: number; total: number }[]; zeroLabel: string }) {
  return <div className="reward-rule-section"><h3>{title}</h3><p>{caption}</p><div className="reward-rule-table"><div className="reward-rule-head"><span>{firstLabel}</span><span>本档追加</span><span>累计奖励</span></div><div><span>{zeroLabel}</span><span>0 元</span><b>0 元</b></div>{rows.map((row) => <div key={row.range}><span>{row.range}</span><span>+{row.added} 元</span><b>{row.total} 元</b></div>)}</div></div>;
}

function LevelRulesView({ settings, memberCount, onBack }: { settings: Settings; memberCount: number; onBack: () => void }) {
  const personalMaximum = weeklyMaximum(settings);
  const familyMaximum = personalMaximum * memberCount;
  return <div className="page-stack"><SettingsBack eyebrow="SCORE LEVEL" title="等级计算说明" onBack={onBack} /><section className="card level-rules-card"><p>个人等级使用“个人本周得分 ÷ 个人理论最高分”，双人等级使用“两人总分 ÷ 两人理论最高分之和”。</p><div className="maximum-row"><span>本周个人最高 <b>{personalMaximum} 分</b></span><span>本周家庭最高 <b>{familyMaximum} 分</b></span></div><ul className="level-rule-list"><li className="grade-bloom"><b>晨光</b><span>达到 80% 及以上</span></li><li className="grade-fresh"><b>新芽</b><span>达到 55% 及以上</span></li><li className="grade-calm"><b>清风</b><span>达到 25% 及以上</span></li><li className="grade-steady"><b>守夜</b><span>得分为 0 或以上</span></li><li className="grade-reset"><b>重启</b><span>得分低于 0</span></li></ul><small>历史周报使用归档时冻结的计分规则计算理论最高分。</small></section></div>;
}

function SettingsBack({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) {
  return <div className="subpage-head"><button onClick={onBack} aria-label="返回设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>;
}

function SyncIndicator({ state, lastSyncedAt }: { state: SyncState; lastSyncedAt: Date | null }) {
  const label = state === "syncing" ? "同步中" : state === "offline" ? "离线" : lastSyncedAt ? `${String(lastSyncedAt.getHours()).padStart(2, "0")}:${String(lastSyncedAt.getMinutes()).padStart(2, "0")} 已同步` : "已同步";
  return <span className={`sync-indicator ${state}`} title={lastSyncedAt ? `最后同步：${lastSyncedAt.toLocaleString("zh-CN")}` : label}><i />{label}</span>;
}

function TierEditor({ title, tiers, disabled, onChange }: { title: string; tiers: RuleTier[]; disabled: boolean; onChange: (index: number, key: keyof RuleTier, value: string) => void }) {
  function commitNumber(event: React.FocusEvent<HTMLInputElement>, index: number, key: "score" | "fine", fallback: number) {
    const value = event.currentTarget.value.trim();
    if (!value || value === "-" || Number.isNaN(Number(value))) {
      event.currentTarget.value = String(fallback);
      return;
    }
    onChange(index, key, value);
  }

  return (
    <div className="tier-editor"><h3>{title}</h3><div className="tier-head"><span>截至</span><span>积分</span><span>罚金</span></div>{tiers.map((tier, index) => (
      <div className="tier-row" key={index}>
        {index === tiers.length - 1 ? <span className="after">更晚</span> : <input type="time" step="300" required disabled={disabled} value={tier.end} onChange={(event) => onChange(index, "end", event.target.value)} />}
        <input key={`score-${tier.score}`} type="number" inputMode="decimal" step="0.1" disabled={disabled} defaultValue={tier.score} onBlur={(event) => commitNumber(event, index, "score", tier.score)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        <input key={`fine-${tier.fine}`} type="number" inputMode="numeric" disabled={disabled} defaultValue={tier.fine} onBlur={(event) => commitNumber(event, index, "fine", tier.fine)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </div>
    ))}</div>
  );
}

function NavButton({ active, icon, label, badge = 0, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}{badge > 0 && <b className="nav-badge">{badge}</b>}</span>{label}</button>;
}

function Stat({ label, value, suffix = "" }: { label: string; value: string; suffix?: string }) {
  return <div className="stat"><span>{label}</span><div><strong>{value}</strong>{suffix && <em>{suffix}</em>}</div></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><span>☾</span><p>{text}</p></div>;
}

type ScoreLevel = { name: string; tone: "bloom" | "fresh" | "calm" | "steady" | "reset"; description: string };

function ScorePanel({ label, score, level, icon }: { label: string; score: number; level: ScoreLevel; icon: string }) {
  return <div className={`score-panel grade-${level.tone}`}><span>{icon} {label}</span><div><strong>{score > 0 ? "+" : ""}{formatScore(score)}</strong><em>分</em></div><small>{level.name} · {level.description}</small></div>;
}

function ScoreTag({ score, level }: { score: number; level: ScoreLevel }) {
  return <span className={`score-tag grade-${level.tone}`}><b>{score > 0 ? "+" : ""}{formatScore(score)}</b><small>{level.name}</small></span>;
}

function GradeBadge({ level }: { level: ScoreLevel }) {
  return <span className={`grade-badge grade-${level.tone}`}><i />{level.name}</span>;
}

function scoreText(score: number) {
  return `${score > 0 ? "+" : ""}${formatScore(score)} 分`;
}

function formatScore(score: number) {
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function tierReward(score: number, tiers: readonly { minimum: number; total: number }[]) {
  return tiers.reduce((reward, tier) => score >= tier.minimum ? tier.total : reward, 0);
}

function weeklyReward(summary: WeekSummary, members: Member[], rewardRuleVersion = "v4") {
  const rules = rewardRuleVersions[rewardRuleVersion as keyof typeof rewardRuleVersions] ?? rewardRuleVersions.v4;
  const scores = members.map((member) => summary.members[member.id]?.totalScore ?? 0);
  const personal = members.map((member, index) => {
    const recordedDays = summary.members[member.id]?.checkinDays ?? 0;
    const eligible = recordedDays >= rules.minimumCheckinDays && scores[index] >= rules.personalMinimum;
    return {
      member,
      payer: members.find((candidate) => candidate.id !== member.id),
      recordedDays,
      eligible,
      amount: eligible ? tierReward(scores[index], rules.personal) : 0,
    };
  });
  const familyScore = Math.round(scores.reduce((total, score) => total + score, 0) * 10) / 10;
  const familyEligible = members.length === 2 && members.every((member, index) => scores[index] >= rules.personalMinimum && (summary.members[member.id]?.checkinDays ?? 0) >= rules.minimumCheckinDays);
  const family = familyEligible ? tierReward(familyScore, rules.family) : 0;
  const total = Math.min(300, personal.reduce((sum, item) => sum + item.amount, 0) + family);
  return { personal, familyScore, familyEligible, personalMinimum: rules.personalMinimum, minimumCheckinDays: rules.minimumCheckinDays, family, total };
}

function weeklyMaximum(settings: Settings, weekStart?: string, weekEnd?: string) {
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

type ExemptionUsage = { approved: number; pending: number; remaining: number };
type ReviewMemberMetric = {
  member: Member;
  validDays: number;
  completionRate: number;
  averageTime: string;
  totalScore: number;
  totalFine: number;
  exemptions: number;
  firstAverage: string;
  lastAverage: string;
  trendMinutes: number;
  trendAvailable: boolean;
};

function allRecordedDays(family: Family) {
  const days = new Map<string, DayResult>();
  for (const archive of family.weeklyArchives ?? []) {
    for (const day of archive.dailySnapshot ?? []) days.set(day.date, day);
  }
  for (const day of family.activeWeek.days ?? []) days.set(day.date, day);
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function dateInTimezone(timezone: string, value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function currentNightDate(timezone: string, cutoffHour: number) {
  const now = new Date();
  const date = dateInTimezone(timezone, now);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((item) => item.type === "hour")?.value ?? "0");
  return hour < cutoffHour ? addDateDays(date, -1) : date;
}

function addDateDays(date: string, offset: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  const startValue = new Date(`${start}T00:00:00Z`).getTime();
  const endValue = new Date(`${end}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((endValue - startValue) / 86_400_000) + 1);
}

function monthlyExemptionUsage(family: Family) {
  const month = dateInTimezone(family.timezone, new Date()).slice(0, 7);
  const result: Record<string, ExemptionUsage> = {};
  const days = allRecordedDays(family).filter((day) => day.date.startsWith(month));
  for (const member of family.members) {
    const approved = days.filter((day) => day.members[member.id]?.exempt).length;
    const pending = (family.pendingExemptions ?? []).filter((change) => change.memberId === member.id && change.date.startsWith(month)).length;
    result[member.id] = { approved, pending, remaining: Math.max(0, 2 - approved - pending) };
  }
  return { month, members: result };
}

function averageReviewTime(records: Array<{ time: string; exempt?: boolean }>) {
  const values = records.filter((record) => !record.exempt && record.time).map((record) => nightMinutes(record.time));
  if (values.length === 0) return { text: "--:--", minutes: null };
  const average = Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  const normalized = average % (24 * 60);
  return { text: `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`, minutes: average };
}

function comparisonMetrics(days: DayResult[], members: Member[]) {
  const records = days.flatMap((day) => members.flatMap((member) => day.members[member.id] ? [day.members[member.id]] : []));
  const average = averageReviewTime(records);
  return {
    validRecords: records.length,
    score: Math.round(records.reduce((total, record) => total + record.score, 0) * 10) / 10,
    averageTime: average.text,
    averageMinutes: average.minutes,
  };
}

function differenceText(value: number, unit: string) {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "与上周持平";
  return `较上周 ${rounded > 0 ? "+" : ""}${formatScore(rounded)} ${unit}`;
}

function buildReviewMetrics(family: Family) {
  const today = dateInTimezone(family.timezone, new Date());
  const start = family.rewardReview?.cycleStartedAt ? dateInTimezone(family.timezone, new Date(family.rewardReview.cycleStartedAt)) : addDateDays(today, -29);
  const scheduledEnd = family.rewardReview?.nextReviewAt ? addDateDays(dateInTimezone(family.timezone, new Date(family.rewardReview.nextReviewAt)), -1) : addDateDays(start, 29);
  const end = today < scheduledEnd ? today : scheduledEnd;
  const safeEnd = end < start ? start : end;
  const elapsedDays = Math.min(30, inclusiveDays(start, safeEnd));
  const days = allRecordedDays(family).filter((day) => day.date >= start && day.date <= safeEnd);
  const firstEnd = addDateDays(start, Math.min(6, elapsedDays - 1));
  const lastStart = addDateDays(safeEnd, -Math.min(6, elapsedDays - 1));

  const members: ReviewMemberMetric[] = family.members.map((member) => {
    const memberDays = days.flatMap((day) => day.members[member.id] ? [{ date: day.date, record: day.members[member.id] }] : []);
    const records = memberDays.map((item) => item.record);
    const first = averageReviewTime(memberDays.filter((item) => item.date <= firstEnd).map((item) => item.record));
    const last = averageReviewTime(memberDays.filter((item) => item.date >= lastStart).map((item) => item.record));
    const average = averageReviewTime(records);
    const trendAvailable = first.minutes !== null && last.minutes !== null;
    return {
      member,
      validDays: records.length,
      completionRate: Math.round(records.length * 100 / elapsedDays),
      averageTime: average.text,
      totalScore: records.reduce((total, record) => total + record.score, 0),
      totalFine: records.reduce((total, record) => total + record.fine, 0),
      exemptions: records.filter((record) => record.exempt).length,
      firstAverage: first.text,
      lastAverage: last.text,
      trendMinutes: trendAvailable ? (last.minutes as number) - (first.minutes as number) : 0,
      trendAvailable,
    };
  });
  const validRecords = members.reduce((total, member) => total + member.validDays, 0);
  const completeReports = (family.weeklyArchives ?? []).filter((report) => report.weekStart >= start && report.weekEnd <= safeEnd);
  const rewardReference = completeReports.reduce((total, report) => total + weeklyReward(report.summary, family.members, report.rewardRuleVersion).total, 0);
  return {
    start,
    end: safeEnd,
    elapsedDays,
    members,
    completionRate: Math.round(validRecords * 100 / (elapsedDays * Math.max(1, family.members.length))),
    rewardReference,
    rewardWeeks: completeReports.length,
  };
}

function reviewTrendText(metric: ReviewMemberMetric) {
  if (!metric.trendAvailable) return "记录不足";
  if (Math.abs(metric.trendMinutes) <= 5) return "基本稳定";
  return metric.trendMinutes < 0 ? `平均提前 ${Math.abs(metric.trendMinutes)} 分钟` : `平均推迟 ${metric.trendMinutes} 分钟`;
}

function scoreLevel(score: number, maximum: number): ScoreLevel {
  const ratio = maximum > 0 ? score / maximum : score > 0 ? 1 : score < 0 ? -1 : 0;
  if (ratio >= 0.8) return { name: "晨光", tone: "bloom", description: "状态闪闪发光" };
  if (ratio >= 0.55) return { name: "新芽", tone: "fresh", description: "节奏稳定生长" };
  if (ratio >= 0.25) return { name: "清风", tone: "calm", description: "正在靠近目标" };
  if (ratio >= 0) return { name: "守夜", tone: "steady", description: "再早一点就好" };
  return { name: "重启", tone: "reset", description: "下周轻轻重来" };
}

function memberColor(index: number) {
  return ["#5f9f8b", "#e38a73", "#7896bd"][index % 3];
}

function nightMinutes(value: string) {
  const [rawHour, minute] = value.split(":").map(Number);
  const hour = rawHour < 12 ? rawHour + 24 : rawHour;
  return hour * 60 + minute;
}

function nearestFiveMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const rounded = Math.min(55, Math.round(minute / 5) * 5);
  return `${String(hour).padStart(2, "0")}:${String(rounded).padStart(2, "0")}`;
}

function validateSettingsDraft(settings: Settings) {
  if (!settings.idealTime) return "请选择理想入睡时间";
  for (const [label, tiers] of [["工作日", settings.weekdayTiers], ["周末", settings.weekendTiers]] as const) {
    let previous = -1;
    for (let index = 0; index < tiers.length - 1; index += 1) {
      if (!tiers[index].end) return `${label}第 ${index + 1} 档缺少截至时间`;
      const current = nightMinutes(tiers[index].end);
      if (current <= previous) return `${label}各档截至时间必须从早到晚排列`;
      previous = current;
    }
  }
  return "";
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${year}年${month}月${day}日`;
}

function weekday(date: string) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00`).getDay()];
}

function dateRange(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const final = new Date(`${end}T12:00:00`);
  while (cursor <= final) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}
