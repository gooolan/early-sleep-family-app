import { AppIcon } from "./AppIcon";
import { dateRange, formatScore, scoreLevel, weeklyMaximum } from "./scorePresentation";
import type { Family } from "./types";

export function TodayView({ family, loading, onCheckIn, onReview, reviewCount }: { family: Family; loading: boolean; onCheckIn: () => void; onReview: () => void; reviewCount: number }) {
  const me = family.currentMember;
  const incomingChanges = (family.pendingChanges ?? []).filter((change) => change.requestedBy !== me.id);
  const incomingExemptions = (family.pendingExemptions ?? []).filter((change) => change.requestedBy !== me.id);
  const backfills = incomingChanges.filter((change) => !change.originalTime).length;
  const edits = incomingChanges.length - backfills;
  const reviewSummary = [backfills > 0 && `补卡 ${backfills} 项`, edits > 0 && `时间修改 ${edits} 项`, incomingExemptions.length > 0 && `豁免 ${incomingExemptions.length} 项`].filter(Boolean).join(" · ");
  const latest = [...(family.activeWeek.days ?? [])].reverse().find((day) => day.members[me.id]);
  const weekDays = dateRange(family.activeWeek.weekStart, family.activeWeek.weekEnd).length;
  const personalMaximum = weeklyMaximum(family.activeWeek.settings, family.activeWeek.weekStart, family.activeWeek.weekEnd);
  const familyScore = family.members.reduce((total, member) => total + (family.activeWeek.summary.members[member.id]?.totalScore ?? 0), 0);
  const familyLevel = scoreLevel(familyScore, personalMaximum * family.members.length);
  return (
    <div className="page-stack home-page">
      <div className="home-greeting"><h2>把今天，轻轻放下。</h2><p>每一次早点睡，都是在照顾明天的自己。</p></div>
      <section className="hero-card">
        <div className="night-illustration" aria-hidden="true"><div className="moon-orbit" /><div className="night-moon" /><i /><i /><i /><i /></div>
        <div className="hero-copy"><span className="eyebrow light">今晚的约定</span>
        <div className="ideal-time">{family.activeWeek.settings.idealTime}</div>
        <p>在这之前，说一声晚安</p></div>
        <button className="checkin-button" onClick={onCheckIn} disabled={loading}><AppIcon name="☾" />{loading ? "正在记录…" : "我要睡了，记录此刻"}<span aria-hidden="true">↗</span></button>
        <span className="hint">凌晨 {family.activeWeek.settings.cutoffHour}:00 前会算作前一天晚上</span>
      </section>

      {reviewCount > 0 && <section className="today-tasks" aria-label="待确认事项">
        <div className="review-heading"><h3>需要你看一眼</h3><span>{reviewCount} 项待确认</span></div>
        <button onClick={onReview}><span className="task-count"><AppIcon name="✓" /></span><span><b>对方的申请等你确认</b><small>{reviewSummary || "查看补卡、时间修改或豁免申请"}</small></span><span className="review-arrow" aria-hidden="true">›</span></button>
      </section>}

      {latest && <div className="latest-row"><span>最近一次 · {latest.date}</span><strong>{latest.members[me.id].exempt ? "已豁免　0 分" : `${latest.members[me.id].time}　${scoreText(latest.members[me.id].score)}`}</strong></div>}

      <section className="dream-overview" aria-labelledby="dream-overview-title">
        <div className="dream-overview-heading"><h2 id="dream-overview-title">一起积攒好梦</h2><span>{family.activeWeek.weekStart.slice(5).replace("-", ".")} — {family.activeWeek.weekEnd.slice(5).replace("-", ".")}</span></div>
        <div className="dream-totals">
          <div className="dream-total-score"><span>{family.members.length > 1 ? "双人本周总分" : "本周总分"}</span><div><strong>{signedScore(familyScore)}</strong><small>分</small><em className={`grade-${familyLevel.tone}`}>{familyLevel.name}</em></div></div>
          <div className="dream-completion"><span>家庭完成度</span><div><strong>{family.activeWeek.summary.completionRate}<small>%</small></strong></div><div className="dream-progress" role="progressbar" aria-label="家庭本周完成度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={family.activeWeek.summary.completionRate}><span style={{ width: `${family.activeWeek.summary.completionRate}%` }} /></div></div>
        </div>
        <table className="dream-member-table" aria-label="两位成员的本周统计">
          <thead><tr><th scope="col">成员</th><th scope="col">本周分值</th><th scope="col">打卡</th><th scope="col">平均入睡</th></tr></thead>
          <tbody>{family.members.map((member) => {
            const summary = family.activeWeek.summary.members[member.id];
            const score = summary?.totalScore ?? 0;
            const level = scoreLevel(score, personalMaximum);
            return <tr key={member.id} className={member.id === me.id ? "current-member" : undefined}>
              <th scope="row"><span className="dream-member-name" title={member.name}>{member.name}</span>{member.id === me.id && <small className="dream-me">我</small>}</th>
              <td aria-label={member.id === me.id ? "我的本周分值" : `${member.name}的本周分值`}><span className={`dream-member-score grade-${level.tone}`} title={level.name}>{signedScore(score)}</span></td>
              <td>{summary?.checkinDays ?? 0}<small>/{weekDays}</small></td>
              <td className={!summary?.averageSleepTime || summary.averageSleepTime === "--:--" ? "dream-empty-value" : undefined}>{summary?.averageSleepTime && summary.averageSleepTime !== "--:--" ? summary.averageSleepTime : "—"}</td>
            </tr>;
          })}</tbody>
        </table>
        <div className="dream-calendar-heading"><span>我的本周记录</span><small>已记录 {family.activeWeek.summary.members[me.id]?.checkinDays ?? 0} / {weekDays} 晚</small></div>
        <div className="week-rhythm" aria-label="本周个人打卡进度">{dateRange(family.activeWeek.weekStart, family.activeWeek.weekEnd).map((date) => {
          const recorded = Boolean(family.activeWeek.days?.find((day) => day.date === date)?.members[me.id]);
          return <div key={date} className={recorded ? "completed" : ""} aria-label={`${date} ${recorded ? "已记录" : "未记录"}`}><span>{weekday(date)}</span><i>{recorded ? <AppIcon name="✓" /> : <AppIcon name="☾" />}</i><small>{date.slice(8)}</small></div>;
        })}</div>
      </section>
    </div>
  );
}

function signedScore(score: number) {
  return `${score > 0 ? "+" : ""}${formatScore(score)}`;
}

function scoreText(score: number) {
  return `${score > 0 ? "+" : ""}${formatScore(score)} 分`;
}

function weekday(date: string) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00`).getDay()];
}
