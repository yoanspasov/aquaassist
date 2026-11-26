// Проверка на стартирането: splash веднага, Firebase/QR с defer, Google Fonts без блокиране,
// съобщение при бавно зареждане (8 с), офлайн, блокирани външни ресурси, QR, банер „Обнови“.
// Пускане: node tests/startup.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
// AQ_BEFORE=път_до_html — пуска същите сценарии срещу друга версия на index.html (за сравнение).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9531;
const BASE = `http://localhost:${PORT}/`;
const HTML_OVERRIDE = process.env.AQ_BEFORE || null;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = (p === '/index.html' && HTML_OVERRIDE) ? HTML_OVERRIDE : path.join(DIR, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'text/html; charset=utf-8' });
    res.end(data);
  });
}).listen(PORT);

const DAY = 86400000;
const small = { schemaVersion: 1, theme: 'ocean', active: 0, tanks: [{ name: 'S', aqType: 'Общ аквариум (Community)', aqLiters: '100', fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: [] }] };
const bigData = () => {
  const tanks = [];
  for (let k = 0; k < 5; k++) {
    const history = [], wc = [], maint = [], timeline = [];
    for (let i = 0; i < 1500; i++) history.push({ t: Date.now() - (1500 - i) * 3600000, temp: 25, ph: 7, nh3: 0, no2: 0, no3: 10, gh: 6, kh: 4, cl2: 0 });
    for (let i = 0; i < 400; i++) wc.push({ t: Date.now() - i * DAY, percent: 20, liters: 20 });
    for (let i = 0; i < 200; i++) maint.push({ id: 'taskFilter', label: 'Почистване на филтър', t: Date.now() - i * DAY });
    for (let i = 0; i < 300; i++) timeline.push({ t: Date.now() - i * DAY, note: 'Бележка ' + i, photoId: null });
    tanks.push({ name: 'Big' + k, aqType: 'Общ аквариум (Community)', aqLiters: '100', fish: [], history, waterChangeLog: wc, maintenanceLog: maint, inhabitantLog: [], timeline, expenses: [], dosing: [] });
  }
  return { schemaVersion: 1, theme: 'ocean', active: 0, tanks };
};

const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};
const IGNORE = /cloudflare|Failed to load resource|ERR_FAILED|net::ERR|blocked by CORS|gstatic|googleapis|cdnjs/i;

async function openPage(browser, { data = small, lang = 'bg', route = null, offline = false, warm = false }) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e.message || e).slice(0, 160)));
  p.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  if (route) await route(p);
  if (warm) {
    await p.goto(BASE);
    await p.evaluate(([st, l]) => { localStorage.clear(); localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st)); localStorage.setItem('aquaAssistantHasData_v1', '1'); localStorage.setItem('aquaAssistLang', l); localStorage.setItem('aquaAssistSeenVersion', '3.6.99'); }, [data, lang]);
    await p.waitForTimeout(1500);
  }
  if (offline) await ctx.setOffline(true);
  return { ctx, p, errs };
}

// Чакаме splash да се скрие (или 25 с). Връща времената спрямо старта на навигацията.
async function timeSplash(p, startMs) {
  let seen = null, hidden = null, slowShown = null;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && hidden === null) {
    const st = await p.evaluate(() => {
      const s = document.getElementById('splashScreen');
      const slow = document.getElementById('splashSlow');
      return { splash: !!s, slow: !!(slow && slow.style.display === 'block' && getComputedStyle(slow).display !== 'none') };
    }).catch(() => null);
    if (st) {
      if (st.splash && seen === null) seen = Date.now() - startMs;
      if (st.slow && slowShown === null) slowShown = Date.now() - startMs;
      if (!st.splash && seen !== null) hidden = Date.now() - startMs;
    }
    await p.waitForTimeout(50);
  }
  return { seen, hidden, slowShown };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // 1) Нормално зареждане, чисто състояние
  {
    const { ctx, p, errs } = await openPage(browser, {});
    const t = Date.now();
    await p.goto(BASE, { waitUntil: 'commit' });
    const tm = await timeSplash(p, t);
    const fbOk = await p.evaluate(() => typeof fbReady !== 'undefined' ? fbReady : null).catch(() => null);
    out.normal_clean = { ...tm, firebaseReady: fbOk, errors: errs.slice(0, 5) };
    check(tm.seen !== null && tm.seen < 1000, 'normal: splash не се вижда веднага');
    check(tm.hidden !== null && tm.hidden < 4000, 'normal: splash не изчезва навреме');
    check(fbOk === true, 'normal: Firebase не се инициализира');
    check(errs.length === 0, 'normal: грешки в конзолата: ' + errs.join(' | '));
    await ctx.close();
  }

  // 2) Блокиране на gstatic.com, fonts.googleapis.com и cdnjs (висят, без отговор)
  {
    const hang = async p => {
      await p.route(/gstatic\.com|fonts\.googleapis\.com|cdnjs\.cloudflare\.com/, () => {});
    };
    const { ctx, p, errs } = await openPage(browser, { route: hang });
    const t = Date.now();
    await p.goto(BASE, { waitUntil: 'commit' });
    const tm = await timeSplash(p, t);
    let works = false;
    try { await p.evaluate(() => switchTab('aquarium')); await p.waitForTimeout(150); works = await p.evaluate(() => { const s = document.getElementById('secParams'); return !!(s && s.offsetParent); }); } catch (e) {}
    const fbOk = await p.evaluate(() => typeof fbReady !== 'undefined' ? fbReady : null).catch(() => null);
    out.blocked_external = { ...tm, appWorks: works, firebaseReady: fbOk, errors: errs.slice(0, 5) };
    check(tm.seen !== null && tm.seen < 1500, 'blocked: splash не се показва веднага');
    check(tm.hidden !== null && tm.hidden < 5000, 'blocked: приложението не се показва');
    check(works, 'blocked: приложението не работи (таб Аквариум)');
    check(fbOk === false, 'blocked: Firebase се е инициализирал без SDK');
    check(errs.length === 0, 'blocked: грешки в конзолата: ' + errs.join(' | '));
    await ctx.close();
  }

  // 3) Firebase се забавя 5 с: синхронизацията се включва, когато SDK се зареди
  {
    const delayed = async p => { await p.route(/gstatic\.com/, async r => { await new Promise(res => setTimeout(res, 5000)); await r.continue(); }); };
    const { ctx, p, errs } = await openPage(browser, { route: delayed });
    const t = Date.now();
    await p.goto(BASE, { waitUntil: 'commit' });
    const tm = await timeSplash(p, t);
    let fbAt = null; const d = Date.now() + 15000;
    while (Date.now() < d && fbAt === null) { const v = await p.evaluate(() => (typeof fbReady !== 'undefined' && fbReady) === true).catch(() => false); if (v) fbAt = Date.now() - t; await p.waitForTimeout(100); }
    out.firebase_delayed_5s = { ...tm, firebaseReadyAfterMs: fbAt, errors: errs.slice(0, 5) };
    check(fbAt !== null && fbAt >= 4500, 'delayed firebase: не се включва след зареждане');
    check(tm.seen !== null && tm.seen < 1500, 'delayed firebase: splash не се показва веднага');
    await ctx.close();
  }

  // 4) Локалният tailwind.css се забавя 9 с: след 8 с splash показва съобщението; после изчезва
  {
    const slowCss = async p => { await p.route(/tailwind\.css/, async r => { await new Promise(res => setTimeout(res, 9000)); await r.continue(); }); };
    const { ctx, p, errs } = await openPage(browser, { route: slowCss });
    const t = Date.now();
    await p.goto(BASE, { waitUntil: 'commit' });
    const tm = await timeSplash(p, t);
    const msgAfterHide = await p.evaluate(() => { const s = document.getElementById('splashSlow'); return s ? getComputedStyle(s).display : 'missing'; }).catch(() => 'gone');
    out.slow_css_9s = { ...tm, slowMessageShownAt: tm.slowShown, messageAfterHide: msgAfterHide, errors: errs.slice(0, 5) };
    check(tm.slowShown !== null && tm.slowShown >= 7500 && tm.slowShown <= 9500, 'slow: съобщението не се показва след ~8 с');
    check(msgAfterHide === 'none' || msgAfterHide === 'gone' || msgAfterHide === 'missing', 'slow: съобщението не се скрива след показване на приложението');
    await ctx.close();
  }

  // 5) Офлайн след първо зареждане (service worker кешира)
  {
    const { ctx, p, errs } = await openPage(browser, { warm: true, offline: true });
    const t = Date.now();
    await p.goto(BASE, { waitUntil: 'commit' });
    const tm = await timeSplash(p, t);
    let works = false;
    try { await p.evaluate(() => switchTab('aquarium')); await p.waitForTimeout(150); works = await p.evaluate(() => !!document.getElementById('secParams').offsetParent); } catch (e) {}
    out.offline = { ...tm, appWorks: works, errors: errs.slice(0, 5) };
    check(tm.hidden !== null, 'offline: splash не изчезва');
    check(works, 'offline: приложението не работи');
    await ctx.close();
  }

  // 6) Бавна мрежа (400 ms закъснение, 50 KB/s) и голям обем данни
  for (const [name, data] of [['slow_small', small], ['big_data', bigData()]]) {
    const { ctx, p, errs } = await openPage(browser, { data, warm: true });
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
    const t = Date.now();
    await p.goto(BASE, { waitUntil: 'commit' });
    const tm = await timeSplash(p, t);
    out[name] = { ...tm, errors: errs.slice(0, 5) };
    await ctx.close();
  }

  // 7) QR, банерът „Обнови“, смяна на езика, облачна готовност (нормална връзка)
  {
    const { ctx, p, errs } = await openPage(browser, { data: small, warm: true });
    await p.goto(BASE); await p.evaluate(() => { localStorage.setItem('aquaAssistSyncCode', 'testcode123'); }); await p.reload(); await p.waitForFunction(() => typeof toggleQR === 'function'); await p.waitForTimeout(800);
    const qr = await p.evaluate(() => { try { switchTab('more'); toggleQR(); } catch (e) { return 'ERR ' + e.message; } return true; });
    await p.waitForTimeout(500);
    const qrOk = await p.evaluate(() => { const b = document.getElementById('qrCanvas'); return !!(b && (b.querySelector('canvas') || b.querySelector('img'))); });
    await p.evaluate(() => showAppUpdateBanner({ waiting: null })); await p.waitForTimeout(100);
    const banner = await p.evaluate(() => !!document.getElementById('appUpdateReloadBtn'));
    await p.evaluate(() => setLanguage('en')); await p.waitForTimeout(300);
    const enTitle = await p.evaluate(() => document.getElementById('appUpdateReloadBtn') ? document.getElementById('appUpdateReloadBtn').innerText : null);
    await p.evaluate(() => setLanguage('bg')); await p.waitForTimeout(200);
    out.features = { qr: qrOk, qrCall: qr, updateBanner: banner, bannerEnText: enTitle, errors: errs.slice(0, 5) };
    check(qrOk, 'QR: не се показва QR код');
    check(banner, 'банерът „Обнови“ не се показва');
    check(enTitle === 'Update', 'банерът „Обнови“ не се превежда при смяна на езика');
    check(errs.length === 0, 'features: грешки: ' + errs.join(' | '));
    await ctx.close();
  }

  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
