// Проверка на service worker-а за навигацията: 3 с таймаут с връщане на кеша, кеш само за успешни отговори,
// офлайн, нова версия с банер „Обнови“, запазени данни, непозната страница, облак/QR.
// Пускане: node tests/sw_navigation.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9541;
const BASE = `http://localhost:${PORT}/`;
// Управление на сървъра от теста (само за имитация на мрежата)
const flags = { indexDelay: 0, indexStatus: 200, marker: 'm1', swName: null };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const send = (status, body, type) => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
  if (p === '/index.html') {
    const serve = () => {
      if (flags.indexStatus !== 200) return send(flags.indexStatus, 'server error', 'text/html; charset=utf-8');
      fs.readFile(path.join(DIR, 'index.html'), 'utf8', (e, d) => { if (e) return send(404, 'nf', 'text/plain'); send(200, d.replace('<head>', `<head><!--marker:${flags.marker}-->`), 'text/html; charset=utf-8'); });
    };
    return flags.indexDelay ? setTimeout(serve, flags.indexDelay) : serve();
  }
  if (p === '/service-worker.js' && flags.swName) {
    return fs.readFile(path.join(DIR, 'service-worker.js'), 'utf8', (e, d) => {
      if (e) return send(404, 'nf', 'text/plain');
      send(200, d.replace(/const CACHE_NAME = "[^"]+";/, `const CACHE_NAME = "${flags.swName}";`), 'application/javascript');
    });
  }
  const file = path.join(DIR, p);
  if (!file.startsWith(DIR)) return send(403, 'no', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(404, 'not found', 'text/plain');
    const types = { '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT);

const small = (name) => ({ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [{ name, aqType: 'Общ аквариум (Community)', aqLiters: '100', fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: [] }] });
const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};

async function newPage(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message || e).slice(0, 160)));
  if (seed) {
    await p.goto(BASE);
    // При първо зареждане SW поема контрола и страницата може да се презареди веднъж (вградено поведение)
    await p.waitForTimeout(1500);
    for (let i = 0; i < 5; i++) {
      try {
        await p.evaluate(([st]) => { localStorage.clear(); localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st)); localStorage.setItem('aquaAssistantHasData_v1', '1'); localStorage.setItem('aquaAssistLang', 'bg'); localStorage.setItem('aquaAssistSeenVersion', '3.6.100'); }, [seed]);
        break;
      } catch (e) { await p.waitForTimeout(800); }
    }
  }
  return { ctx, p, errs };
}
const swReady = p => p.evaluate(() => navigator.serviceWorker.ready.then(() => true)).catch(() => false);
// Навигацията записва под адреса на страницата (BASE); ./index.html е от инсталирането
const cachedIndexText = p => p.evaluate(async (base) => { const r = await caches.match(base) || await caches.match('./index.html'); return r ? r.text() : null; }, BASE);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  flags.marker = 'm1'; flags.indexDelay = 0; flags.indexStatus = 200; flags.swName = null;

  // 1) Първо зареждане онлайн: кешът се пълни
  {
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(1500); await swReady(p);
    await p.reload(); await p.waitForTimeout(800);
    const cached = await cachedIndexText(p);
    out['1_first_online'] = { cacheHasIndex: !!cached, hasMarker: !!cached && cached.includes('marker:m1'), errors: errs };
    check(!!cached, '1: кешът няма index.html');
    check(errs.length === 0, '1: грешки ' + errs.join(' | '));
    await ctx.close();
  }

  // 2) Второ зареждане онлайн: мрежата е бърза, кешът се обновява
  {
    flags.marker = 'm2';
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(1200);
    const cached = await cachedIndexText(p);
    out['2_second_online'] = { cacheUpdated: !!cached && cached.includes('marker:m2'), errors: errs };
    check(!!cached && cached.includes('marker:m2'), '2: кешът не се обнови от мрежата');
    await ctx.close();
  }

  // 3) Офлайн след първо зареждане
  {
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(1200); await swReady(p);
    await ctx.setOffline(true);
    await p.reload({ waitUntil: 'commit' }).catch(() => {});
    await p.waitForTimeout(1500);
    const shown = await p.evaluate(() => !!document.getElementById('navBtn-home') || !!document.getElementById('splashScreen'));
    out['3_offline'] = { pageShown: shown, errors: errs };
    check(shown, '3: офлайн не се отваря кешираната страница');
    await ctx.close();
  }

  // 4) Много бавна мрежа (6 с): връща се кешираната страница; мрежата обновява кеша във фон
  {
    // Първо: кешът да съдържа m2 (бързо зареждане). После мрежата връща m3, но след 6 с.
    flags.marker = 'm2'; flags.indexDelay = 0;
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(1200); await swReady(p);
    flags.marker = 'm3'; flags.indexDelay = 6000;
    const t0 = Date.now();
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const contentMarker = await p.evaluate(() => document.documentElement.outerHTML.includes('marker:m2') ? 'm2' : (document.documentElement.outerHTML.includes('marker:m3') ? 'm3' : 'none')).catch(() => 'err');
    const elapsedMs = Date.now() - t0;
    await p.waitForTimeout(8000);
    const cached = await cachedIndexText(p);
    flags.indexDelay = 0;
    out['4_slow_network'] = { firstRenderMs: elapsedMs, pageMarker: contentMarker, cacheAfterBackgroundUpdate: cached && cached.includes('marker:m3') ? 'm3' : (cached && cached.includes('marker:m2') ? 'm2' : 'none'), errors: errs };
    check(elapsedMs < 4500, '4: първото показване е след ' + elapsedMs + ' ms (очаквано < 3 с + допуск)');
    check(contentMarker === 'm2', '4: не е върната кешираната страница');
    check(cached && cached.includes('marker:m3'), '4: кешът не се обнови във фон');
    await ctx.close();
  }

  // 5) Бърза мрежа: връща се мрежовата страница
  {
    flags.marker = 'm4';
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(1200);
    const marker = await p.evaluate(() => document.documentElement.outerHTML.includes('marker:m4') ? 'm4' : 'other');
    out['5_fast_network'] = { pageMarker: marker, errors: errs };
    check(marker === 'm4', '5: не е върната мрежовата страница');
    await ctx.close();
  }

  // 6) Нова версия (смяна на CACHE_NAME): банерът „Обнови“ и активиране
  {
    flags.marker = 'm5';
    const seedState = small('Запазен');
    const { ctx, p, errs } = await newPage(browser, seedState);
    await p.reload(); await p.waitForTimeout(1200); await swReady(p);
    flags.swName = 'aquaassistant-cache-v79-test';
    await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    // Чакаме новият SW да е инсталиран и да чака (waiting) — до 15 с
    const dw = Date.now() + 15000;
    while (Date.now() < dw) { const w = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r.waiting; }).catch(() => false); if (w) break; await p.waitForTimeout(300); }
    out['6_debug'] = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { waiting: !!r.waiting, installing: !!r.installing, active: r.active && r.active.scriptURL, controller: !!navigator.serviceWorker.controller, hasBanner: !!document.getElementById('appUpdateReloadBtn') }; });
    let banner = false; const d = Date.now() + 20000;
    while (Date.now() < d && !banner) { banner = await p.evaluate(() => !!document.getElementById('appUpdateReloadBtn')).catch(() => false); if (!banner) await p.waitForTimeout(300); }
    out['6_new_version_banner'] = { banner, errors: errs };
    check(banner, '6: банерът „Обнови“ не се показва');
    if (banner) {
      await p.evaluate(() => document.getElementById('appUpdateReloadBtn').click());
      await p.waitForTimeout(2500);
      const keys = await p.evaluate(() => caches.keys());
      const ctrlUrl = await p.evaluate(() => navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null);
      out['6_after_update'] = { cacheKeys: keys, controller: ctrlUrl };
      check(keys.includes('aquaassistant-cache-v79-test') && !keys.includes('aquaassistant-cache-v78'), '6: старият кеш не е изчистен');
    }
    // 7) Запазените данни след преминаването
    const names = await p.evaluate(() => store.tanks.map(t => t.name));
    out['7_data_kept'] = { tanks: names };
    check(names.includes('Запазен'), '7: запазеният аквариум е изчезнал след обновяването');
    await ctx.close();
    flags.swName = null;
  }

  // 8) Непозната страница
  {
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(800);
    const resp = await p.goto(BASE + 'xyz-unknown').catch(e => ({ status: () => 'err ' + e.message.slice(0, 60) }));
    out['8_unknown_page'] = { status: resp ? resp.status() : null, errors: errs };
    check(errs.length === 0, '8: грешки при непозната страница: ' + errs.join(' | '));
    await ctx.close();
  }

  // 9) Облак и QR (онлайн)
  {
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.evaluate(() => localStorage.setItem('aquaAssistSyncCode', 'testcode123'));
    await p.reload(); await p.waitForFunction(() => typeof toggleQR === 'function'); await p.waitForTimeout(800);
    const fb = await p.evaluate(() => typeof fbReady !== 'undefined' ? fbReady : null);
    await p.evaluate(() => { switchTab('more'); toggleQR(); }); await p.waitForTimeout(500);
    const qr = await p.evaluate(() => { const b = document.getElementById('qrCanvas'); return !!(b && (b.querySelector('canvas') || b.querySelector('img'))); });
    out['9_cloud_qr'] = { firebaseReady: fb, qrShown: qr, note: 'облачният запис към Firestore не е тестван (няма реален код за запис)', errors: errs };
    check(fb === true, '9: Firebase не е готов');
    check(qr, '9: QR не се показва');
    await ctx.close();
  }

  // 10) Сървърна грешка 500: не се кешира; кешът остава с последния добър отговор
  {
    flags.marker = 'm6';
    const { ctx, p, errs } = await newPage(browser, small('A'));
    await p.reload(); await p.waitForTimeout(1200);
    const before = await cachedIndexText(p);
    flags.indexStatus = 500;
    await p.reload({ waitUntil: 'commit' }).catch(() => {});
    await p.waitForTimeout(1500);
    flags.indexStatus = 200;
    const after = await cachedIndexText(p);
    out['10_server_500'] = { cacheBefore: before && before.includes('marker:m6') ? 'm6' : 'other', cacheAfter500: after && after.includes('marker:m6') ? 'm6 (запазен)' : 'променен', errors: errs };
    check(after && after.includes('marker:m6') && after.length > 1000, '10: 500 отговор е записан в кеша');
    await ctx.close();
  }

  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
