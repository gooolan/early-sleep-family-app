// Seed incoming requests through the local API without rotating the preview owner's session.
import assert from 'node:assert/strict';
const backend = process.env.DEMO_API_URL || 'http://127.0.0.1:18080';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(backend).hostname), 'Demo seeding requires a local backend');
async function request(path, body, token, method = 'POST') {
  const response = await fetch(`${backend}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result.data;
}
const partner = await request('/api/v1/sessions', { phone: '19900000002' });
let family = partner.family;
assert.equal(family.name, '菜价体验家庭（本地假数据）', 'Only the designated demo family may be seeded');
assert.equal(family.currentMember.name, '阿辰');
const parts = new Intl.DateTimeFormat('en-US', { timeZone: family.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
const part = key => parts.find(item => item.type === key).value;
const night = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
if (Number(part('hour')) < family.activeWeek.settings.cutoffHour) night.setUTCDate(night.getUTCDate() - 1);
const reachedDate = night.toISOString().slice(0, 10);
const dates = [];
for (const cursor = new Date(`${family.activeWeek.weekStart}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= reachedDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const date = cursor.toISOString().slice(0, 10);
  if (date > family.activeWeek.weekEnd) break;
  dates.push(date);
}
const seeded = [];
for (const [index, date] of dates.slice(0, 3).entries()) {
  if ([...(family.pendingChanges ?? []), ...(family.pendingExemptions ?? [])].some(item => item.memberId === family.currentMember.id && item.date === date)) continue;
  if (family.activeWeek.days?.find(item => item.date === date)?.members[family.currentMember.id]) continue;
  const exemption = index === 2;
  family = exemption
    ? await request('/api/v1/exemptions', { date }, partner.token)
    : await request(`/api/v1/checkins/${date}`, { time: index === 0 ? '22:40' : '23:15', source: 'backfill' }, partner.token, 'PUT');
  seeded.push({ date, kind: exemption ? '豁免' : '补卡' });
}
console.log(JSON.stringify({ backend, family: family.name, seeded, pendingChanges: family.pendingChanges.length, pendingExemptions: family.pendingExemptions.length }, null, 2));
