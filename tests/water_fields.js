// Проверка на полетата за смяна на водата: двете празни полета показват еднаква бледа нула.
// Пускане: node tests/water_fields.js   (виж PLAYWRIGHT_CORE в tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9421;
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

const T = { name: 'W', aqType: 'Общ аквариум (Community)', aqLiters: '100', temp: '25', ph: '7', fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: [] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = {};
  const fail = [];
  const check = (cond, msg) => { if (!cond) fail.push(msg); };
  for (const lang of ['bg', 'en']) for (const unit of ['L', 'gal']) {
    const key = `${lang}_${unit}`;
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 800 } });
    const p = await ctx.newPage();
    await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    await p.goto(BASE);
    await p.evaluate(([st, l, u]) => {
      localStorage.clear();
      localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st));
      localStorage.setItem('aquaAssistantHasData_v1', '1');
      localStorage.setItem('aquaAssistLang', l);
      localStorage.setItem('aquaAssistSeenVersion', '3.6.91');
      localStorage.setItem('aquassist_volume_unit', u);
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T] }, lang, unit]);
    await p.reload();
    await p.waitForFunction(() => typeof switchTab === 'function');
    await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('home'));
    const style = sel => p.evaluate(s => {
      const el = document.querySelector(s); const cs = getComputedStyle(el);
      return { value: el.value, placeholder: el.placeholder, color: cs.color, font: cs.fontSize, height: cs.height, align: cs.textAlign, width: cs.width, ph: getComputedStyle(el, '::placeholder').color };
    }, sel);
    // 1) Празно: и двете полета са празни, с бледа подсказка 0 и еднакъв стил
    const pctE = await style('#waterChangePct');
    const litE = await style('#waterChangeLiters');
    out[key + ' empty'] = { pct: pctE, liters: litE, calc: await p.evaluate(() => [calcLiters.innerText, calcDechlor.innerText, calcFert.innerText]) };
    check(pctE.value === '' && litE.value === '', `${key}: полетата не са празни`);
    check(pctE.placeholder === '0' && litE.placeholder === '0', `${key}: подсказката не е 0`);
    check(pctE.ph === litE.ph && pctE.font === litE.font && pctE.height === litE.height && pctE.align === litE.align && pctE.width === litE.width, `${key}: стиловете на полетата са различни`);
    // 2) Въведен процент 20: обемът се изчислява, литрите показват изчислената стойност
    await p.fill('#waterChangePct', '20'); await p.waitForTimeout(100);
    out[key + ' pct20'] = { liters: await p.evaluate(() => document.getElementById('waterChangeLiters').value), calc: await p.evaluate(() => calcLiters.innerText) };
    // 3) Изтриване на процента -> пак празно
    await p.fill('#waterChangePct', ''); await p.waitForTimeout(100);
    const cleared = await p.evaluate(() => [document.getElementById('waterChangePct').value, document.getElementById('waterChangeLiters').value]);
    check(cleared[0] === '' && cleared[1] === '', `${key}: след изтриване полетата не са празни`);
    // 4) Въведени литри/галони -> процентът се попълва
    await p.fill('#waterChangeLiters', unit === 'gal' ? '5' : '20'); await p.waitForTimeout(100);
    out[key + ' typed'] = await p.evaluate(() => ({ pct: document.getElementById('waterChangePct').value, typed: document.getElementById('waterChangeLiters').value }));
    check(out[key + ' typed'].pct !== '', `${key}: процентът не се изчислява от литрите`);
    // 5) Презареждане: празните полета остават празни
    await p.reload(); await p.waitForFunction(() => typeof switchTab === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('home')); await p.waitForTimeout(100);
    const after = await p.evaluate(() => [document.getElementById('waterChangePct').value, document.getElementById('waterChangeLiters').value]);
    out[key + ' after_reload'] = after;
    check(after[0] === '' && after[1] === '', `${key}: след презареждане полетата не са празни`);
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
