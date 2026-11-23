// Проверка на заглавията със значка/бутон в картите (card-head): значката е на един ред,
// не покрива заглавието и на тесен екран е под него. Ширини 320, 360, 412, 600 px; BG и EN.
// Пускане: node tests/card_heads.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9491;
const BASE = `http://localhost:${PORT}/`;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(DIR, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT);

// Гупи: litersPerFish 1 → брой = процент при обем 100 л
const fish = count => [{ name: 'Гупи (Guppy)', count, note: '', noteAt: 0, addedAt: 0, updatedAt: 0 }];
const T = (count) => ({ name: 'G', aqType: 'Общ аквариум (Community)', aqLiters: '100', temp: '25', ph: '7', fish: fish(count), history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [{ t: Date.now(), category: 'Храна', desc: '', amount: 12345.67 }], dosing: [] });
const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const lang of ['bg', 'en']) for (const w of [320, 360, 412, 600]) {
    const key = `${lang}_${w}`;
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 800 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
    await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    await p.goto(BASE);
    await p.evaluate(([st, l]) => {
      localStorage.clear();
      localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st));
      localStorage.setItem('aquaAssistantHasData_v1', '1');
      localStorage.setItem('aquaAssistLang', l);
      localStorage.setItem('aquaAssistSeenVersion', '3.6.97');
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T(1)] }, lang]);
    await p.reload(); await p.waitForFunction(() => typeof switchTab === 'function'); await p.waitForTimeout(300);
    const measure = () => p.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const heads = [...document.querySelectorAll('.card-head')].filter(h => h.offsetParent !== null);
      return heads.map(h => {
        const t = h.querySelector('.card-title'), b = h.querySelector('.card-badge');
        if (!t || !b) return { id: h.id || '', skip: true };
        const tr_ = r(t), br = r(b);
        const overlap = !(br.left >= tr_.right - 0.5 || br.right <= tr_.left + 0.5 || br.top >= tr_.bottom - 0.5 || br.bottom <= tr_.top + 0.5);
        const stacked = br.top >= tr_.bottom - 1;
        return { text: (t.innerText || '').replace(/\s+/g, ' ').slice(0, 30), badge: (b.innerText || '').replace(/\s+/g, ' ').slice(0, 30), badgeH: Math.round(br.height), badgeOneLine: br.height <= 34, overlap, stacked, alignedLeft: Math.abs(br.left - tr_.left) <= 2 };
      });
    });
    const setCap = async pct => p.evaluate(v => { myFishList[0].count = v; updateCapacity(); }, pct);
    const setBudget = async () => p.evaluate(() => { store.tanks[store.active].expenses = [{ t: Date.now(), category: 'Храна', desc: '', amount: 12345.67 }]; renderExpenses(); });
    const res = {};
    for (const pct of [0, 73, 90, 100, 150]) {
      await p.evaluate(() => switchTab('aquarium')); await p.waitForTimeout(100);
      await setCap(pct); await p.waitForTimeout(80);
      const rows = await measure();
      res['cap' + pct] = rows.filter(x => !x.skip && /Капацитет|Capacity/.test(x.badge));
    }
    await p.evaluate(() => switchTab('more')); await p.waitForTimeout(100);
    await setBudget(); await p.waitForTimeout(80);
    res.budget = (await measure()).filter(x => !x.skip && /Общо|Total/.test(x.badge));
    await p.evaluate(() => switchTab('history')); await p.waitForTimeout(100);
    res.others = (await measure()).filter(x => !x.skip && !/Капацитет|Capacity|Общо|Total/.test(x.badge));
    res.reminders = (await measure()).filter(x => !x.skip && /Всичко|Просрочени|Overdue|fine|наред/i.test(x.badge));
    out[key] = res;
    const all = [...Object.values(res.cap0 ? res : {}), ...[res.budget], ...[res.others]].flat ? null : null;
    // Проверки
    const every = [...[0, 73, 90, 100, 150].map(x => res['cap' + x]), res.budget];
    for (const list of every) for (const x of list) {
      check(x.badgeOneLine, `${key}: значката е на 2 реда (${x.badge}, ${x.badgeH}px)`);
      check(!x.overlap, `${key}: значката покрива заглавието (${x.text})`);
      if (w < 420) check(x.stacked && x.alignedLeft, `${key}: на тесен екран значката не е под заглавието (${x.text})`);
    }
    for (const x of res.others) { check(!x.overlap, `${key}: припокриване в ${x.text}`); check(x.badgeOneLine, `${key}: значката на 2 реда в ${x.text}`); }
    check(errs.length === 0, `${key}: грешки в страницата`);
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
