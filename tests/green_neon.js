// Проверка на новия вид „Зелена неонова тетра“: падащо меню, търсене, добавяне, обем, EN.
// Пускане: node tests/green_neon.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9461;
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

// Съществуващ аквариум (60 л) с Неонова тетра — да проверим, че не се засяга
const T = { name: 'E', aqType: 'Общ аквариум (Community)', aqLiters: '60', temp: '25', ph: '6.5', fish: [{ name: 'Неонова тетра (Neon Tetra)', count: 5, note: '', noteAt: 0, addedAt: 0, updatedAt: 0 }], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: [] };
const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const lang of ['bg', 'en']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 360, height: 800 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
    await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    await p.goto(BASE);
    await p.evaluate(([st, l]) => {
      localStorage.clear();
      localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st));
      localStorage.setItem('aquaAssistantHasData_v1', '1');
      localStorage.setItem('aquaAssistLang', l);
      localStorage.setItem('aquaAssistSeenVersion', '3.6.96');
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T] }, lang]);
    await p.reload(); await p.waitForFunction(() => typeof addAnimalToAquarium === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('add')); await p.waitForTimeout(150);
    // 1) Падащо меню: видът е в списъка
    const opt = await p.evaluate(() => [...document.getElementById('animalSelect').options].map(o => o.textContent).find(t => /Зелена|Green Neon/.test(t)) || null);
    out[lang + ' option'] = opt;
    check(!!opt, lang + ': видът липсва в падащото меню');
    check(opt === (lang === 'bg' ? 'Зелена неонова тетра' : 'Green Neon Tetra'), lang + ': грешно име в менюто: ' + opt);
    // 2) Търсене по двата езика
    for (const q of [lang === 'bg' ? 'зелена' : 'green neon']) {
      await p.evaluate(v => { const s = document.getElementById('animalSearch'); s.value = v; s.dispatchEvent(new Event('input')); }, q);
      await p.waitForTimeout(150);
      const n = await p.evaluate(() => [...document.getElementById('animalSelect').options].filter(o => /Зелена|Green Neon/.test(o.textContent)).length);
      out[lang + ' search ' + q] = n;
      check(n >= 1, `${lang}: търсенето "${q}" не намира вида`);
    }
    await p.evaluate(() => { const s = document.getElementById('animalSearch'); s.value = ''; s.dispatchEvent(new Event('input')); });
    // 3) Обемът: 60 л са под 40? не — тест с 30 л: предупреждение за минимален обем
    await p.evaluate(() => { const i = [...document.getElementById('animalSelect').options].findIndex(o => /Зелена|Green Neon/.test(o.textContent)); document.getElementById('animalSelect').selectedIndex = i; document.getElementById('animalSelect').dispatchEvent(new Event('change')); });
    await p.waitForTimeout(100);
    const card = await p.evaluate(() => document.getElementById('animalCard').innerText.replace(/\s+/g, ' '));
    out[lang + ' card'] = card.slice(0, 160);
    check(/40/.test(card), lang + ': картата не показва минималния обем 40');
    // 4) Добавяне на 6 бр. -> записва се; броят на Неоновата остава
    await p.evaluate(() => { document.getElementById('animalCount').value = '6'; });
    await p.click('button[onclick="addAnimalToAquarium()"]'); await p.waitForTimeout(150);
    const fish = await p.evaluate(() => store.tanks[store.active].fish.map(f => [f.name, f.count]));
    out[lang + ' fish'] = fish;
    check(fish.some(f => f[0] === 'Зелена неонова тетра (Green Neon Tetra)' && f[1] === 6), lang + ': видът не е добавен с 6 бр.');
    check(fish.some(f => f[0] === 'Неонова тетра (Neon Tetra)' && f[1] === 5), lang + ': запазената Неонова тетра е засегната');
    // 5) Предупреждение за обем (60 л са над 40 — няма; при 30 л има)
    await p.evaluate(() => { document.getElementById('aqLiters').dataset.liters = '30'; });
    await p.evaluate(() => { switchTab('inhabitants'); const b = document.getElementById('compatAlert'); }); await p.waitForTimeout(150);
    await p.evaluate(() => { store.tanks[store.active].aqLiters = '30'; applyTank(); refreshAfterTankChange(); });
    await p.waitForTimeout(150);
    const warn = await p.evaluate(() => document.getElementById('compatText').innerText.replace(/\s+/g, ' '));
    out[lang + ' volume_warning'] = warn.slice(0, 200);
    check(/40/.test(warn), lang + ': предупреждението за минимален обем липсва');
    // 6) Енциклопедия показва вида
    await p.evaluate(() => switchTab('encyclopedia')); await p.waitForTimeout(150);
    const enc = await p.evaluate(() => [...document.getElementById('encAnimalSelect').options].map(o => o.textContent).some(t => /Зелена|Green Neon/.test(t)));
    out[lang + ' encyclopedia'] = enc;
    check(enc, lang + ': видът липсва в енциклопедията');
    out[lang + ' errors'] = errs;
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
