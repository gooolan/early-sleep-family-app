// Run against a local backend with a temporary DATA_DIR; this creates test families.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const api = process.env.UX_API_URL || 'http://127.0.0.1:18080';
const web = process.env.UX_WEB_URL || 'http://127.0.0.1:5174';
const out = process.env.UX_OUTPUT_DIR || mkdtempSync(join(tmpdir(), 'early-sleep-ux-'));
for (const address of [api, web]) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname), 'UI regression only runs against local test services');
}
mkdirSync(out, {recursive:true});
async function request(path, body, token, method='POST') {
  const response = await fetch(api + path, {method,headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data.data;
}
const phone = `1${String(Date.now()).slice(-10)}`;
const owner = await request('/api/v1/families', {familyName:'小兰与阿辰的家',nickname:'小兰',phone,timezone:'Asia/Shanghai'});
const partner = await request('/api/v1/families/join', {joinCode:owner.joinCode,nickname:'阿辰',phone:`1${String(Number(phone.slice(1))+1).padStart(10,'0')}`});
let family = await request('/api/v1/family',undefined,owner.token,'GET');
const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const night = new Date(`${parts}T12:00:00Z`);
if (Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',hour:'numeric',hourCycle:'h23'}).format(new Date())) < family.activeWeek.settings.cutoffHour) night.setUTCDate(night.getUTCDate()-1);
const date = night.toISOString().slice(0,10);
const yesterday = new Date(night); yesterday.setUTCDate(yesterday.getUTCDate()-1);
const past = yesterday.toISOString().slice(0,10) >= family.activeWeek.weekStart ? yesterday.toISOString().slice(0,10) : date;
await request(`/api/v1/checkins/${past}`, {time:'22:45',source:'backfill'},partner.token,'PUT');
family = await request('/api/v1/family',undefined,owner.token,'GET');
const browser = await chromium.launch({channel:process.env.UX_BROWSER_CHANNEL || 'chrome',headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,timezoneId:'Asia/Shanghai'});
await context.addInitScript(({api,owner,family})=>{
  localStorage.setItem('earlySleep.backend',api);
  localStorage.setItem('earlySleep.token',owner.token);
  localStorage.setItem('earlySleep.joinCode',owner.joinCode);
  localStorage.setItem('earlySleep.family.v1',JSON.stringify({version:1,backendURL:api,family}));
},{api,owner,family});
const page = await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
async function shot(name){await page.locator('.toast.success').waitFor({state:'hidden',timeout:5000}).catch(()=>{});await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
async function noOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth),false,`Overflow at ${page.url()}`);}
try {
  await page.goto(web);
  await page.getByRole('button',{name:/我要睡了，记录此刻/}).waitFor();
  assert.equal(await page.getByRole('button',{name:/我要睡了，记录此刻/}).isEnabled(),true);
  await shot('01-today');await noOverflow();
  await page.getByRole('heading',{name:'一起积攒好梦',exact:true}).waitFor();
  assert.equal(await page.getByText(/双人本周总分/).count(),1);
  assert.equal(await page.getByLabel('我的本周分值',{exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:/今天买菜花了多少/}).count(),0);
  assert.equal(await page.getByRole('navigation',{name:'主导航'}).getByRole('button').count(),4);
  await page.getByRole('button',{name:/对方的申请等你确认/}).click();
  await page.getByRole('heading',{name:'等我确认'}).waitFor();
  await shot('02-approvals');
  await page.getByRole('button',{name:'同意',exact:true}).click();
  await page.getByText('暂时没有需要确认的申请').waitFor();
  await page.getByRole('button',{name:'本周记录',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`^${past} `)}).click();
  await page.getByRole('button',{name:past===date?'手动填写入睡时间':'补充入睡时间',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.route('**/api/v1/checkins/*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'test_failure',message:'测试：暂时无法保存'}})}));
  await page.getByRole('button',{name:'提交给对方确认',exact:true}).click();
  await page.getByText('测试：暂时无法保存').waitFor();
  assert.equal(await page.getByRole('dialog').count(),1,'Failed save must keep the editor');
  await page.unroute('**/api/v1/checkins/*');
  await page.getByRole('button',{name:'提交给对方确认',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'查看待确认申请',exact:true}).waitFor();
  await shot('03-records');await noOverflow();
  if (past !== date) {
    await page.getByRole('button',{name:'今天',exact:true}).click();
    await page.getByRole('button',{name:/我要睡了，记录此刻/}).click();
    await page.getByText('今晚打卡成功').waitFor();
    assert.equal(await page.getByRole('button',{name:/我要睡了，记录此刻/}).isEnabled(),true);
    const repeated = page.waitForResponse(response => response.url().endsWith('/checkins/now') && response.request().method() === 'PUT');
    await page.getByRole('button',{name:/我要睡了，记录此刻/}).click();
    assert.equal((await repeated).ok(),true);
    await shot('09-tonight-complete');
    await page.getByRole('button',{name:'早睡',exact:true}).click();
  }
  await page.getByRole('button',{name:'睡眠周报',exact:true}).click();
  await page.getByRole('button',{name:'本周',exact:true}).waitFor();
  await shot('04-report');await noOverflow();
  await page.getByRole('button',{name:'家庭',exact:true}).click();
  await page.getByRole('button',{name:/入睡时间与积分/}).waitFor();
  await shot('05-family');
  await page.getByRole('button',{name:/家庭数据备份/}).click();
  await page.goBack();
  await page.getByRole('button',{name:/家庭数据备份/}).waitFor();
  await page.getByRole('button',{name:'菜价',exact:true}).click();
  await page.getByRole('button',{name:'＋ 记一笔菜价',exact:true}).click();
  await page.getByLabel('商品',{exact:true}).fill('西红柿');
  await page.getByLabel('店铺',{exact:true}).fill('永辉超市');
  assert.equal(await page.getByLabel('单价',{exact:true}).isVisible(),true,'All required inputs should be in the same form');
  assert.equal(await page.getByRole('button',{name:'下一步 · 填价格',exact:true}).count(),0);
  await page.getByLabel('单价',{exact:true}).fill('3.5');
  await shot('06-price-form');await noOverflow();
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'＋ 记一笔菜价',exact:true}).waitFor();
  assert.equal((await request('/api/v1/prices',undefined,owner.token,'GET')).records.length,0,'Back must never submit a price');
  await page.getByRole('button',{name:'＋ 记一笔菜价',exact:true}).click();
  await page.goBack();
  await page.getByRole('button',{name:'＋ 记一笔菜价',exact:true}).waitFor();
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await page.getByRole('button',{name:'菜价',exact:true}).click();
  await page.getByRole('button',{name:'＋ 记一笔菜价',exact:true}).click();
  assert.equal(await page.getByLabel('商品',{exact:true}).inputValue(),'西红柿');
  assert.equal(await page.getByLabel('店铺',{exact:true}).inputValue(),'永辉超市');
  assert.equal(await page.getByLabel('单价',{exact:true}).inputValue(),'3.5');
  await page.route('**/api/v1/price-records',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'test_failure',message:'测试：价格未保存'}})}));
  await page.getByRole('button',{name:'保存这笔菜价',exact:true}).click();
  await page.getByRole('alert').getByText('测试：价格未保存').waitFor();
  assert.equal(await page.getByLabel('单价',{exact:true}).inputValue(),'3.5');
  await page.unroute('**/api/v1/price-records');
  await page.getByRole('button',{name:'保存这笔菜价',exact:true}).click();
  await page.getByRole('button',{name:'现场比价',exact:true}).waitFor();
  await page.getByRole('button',{name:'现场比价',exact:true}).click();
  await page.getByLabel('标签单价',{exact:true}).fill('4');
  await page.getByRole('button',{name:'记录此价格',exact:true}).click();
  assert.equal(await page.getByLabel('商品',{exact:true}).inputValue(),'西红柿');
  await page.getByLabel('店铺',{exact:true}).fill('盒马');
  assert.equal(await page.getByLabel('单价',{exact:true}).inputValue(),'4');
  await page.getByRole('button',{name:'保存，再记一笔',exact:true}).click();
  await page.getByText('上一项已保存',{exact:false}).waitFor();
  assert.equal(await page.getByLabel('店铺',{exact:true}).inputValue(),'盒马');
  assert.equal(await page.getByLabel('商品',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'菜价',exact:true}).click();
  await shot('08-market');
  await page.getByRole('button',{name:'历史记录',exact:true}).click();
  assert.equal(await page.locator('.all-history-row').count(),2);
  await page.getByRole('button',{name:'编辑',exact:true}).first().click();
  await page.getByLabel('单价',{exact:true}).fill('4.2');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.locator('.all-history-row').first().waitFor();
  assert.equal(await page.locator('.all-history-row').count(),2);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'删除',exact:true}).first().click();
  await page.getByRole('button',{name:'撤销',exact:true}).waitFor();
  assert.equal(await page.locator('.all-history-row').count(),1);
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.all-history-row').length===2);
  await page.getByRole('button',{name:'家庭',exact:true}).click();
  await page.getByRole('button',{name:/入睡时间与积分/}).click();
  await page.getByLabel('理想入睡',{exact:true}).fill('22:30');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForResponse(response=>response.url().endsWith('/api/v1/family'));
  assert.equal(await page.getByLabel('理想入睡',{exact:true}).inputValue(),'22:30','Polling must not overwrite unsaved rules');
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await context.setOffline(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await page.getByText('当前离线，显示上次同步内容').waitFor();
  await page.getByRole('button',{name:'菜价',exact:true}).click();
  await page.getByText('西红柿',{exact:true}).waitFor();
  await context.setOffline(false);
  await page.getByText('当前离线，显示上次同步内容').waitFor({state:'hidden'});
  await page.locator('.price-error').waitFor({state:'hidden'});
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900});
    for (const title of ['今天','早睡','菜价','家庭']) { await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:title,exact:true}).click(); await noOverflow(); }
  }
  assert.deepEqual(errors,[]);
  writeFileSync(`${out}/result.json`,JSON.stringify({passed:true,checks:['Four destinations','Real check-in and completed state','Secondary-page back never submits','Browser back to catalog','Price failure retry','Price edit/delete/undo','Polling preserves draft','Offline cached prices and recovery','Incoming approval','Failed edit retained','Successful edit closes','Pending blocks resubmission','Current report','Family back navigation','Single-form secondary price page','Draft across tabs','Compare prefill','Save and add another','320/390/768/1280 no overflow'],errors},null,2));
  console.log('PASS: interaction smoke checks, screenshots in '+out);
} catch(error) { await shot('failure'); console.error(await page.locator('body').innerText()); throw error; }
finally { await browser.close(); }
