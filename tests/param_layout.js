// Проверка на подравняването на картите с параметрите (таб „Аквариум“) и на CO2 картата.
// Пускане: node tests/param_layout.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9471;
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

// Дълги стойности и дълги български заглавия, за да се види подравняването
const T = {
  name: 'F', aqType: 'Общ аквариум (Community)', aqLiters: '300', temp: '27.5', ph: '6.8', nh3: '0.02', no2: '0.02', no3: '123.456', gh: '10', kh: '6', cl2: '0.01',
  fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: []
};
const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const lang of ['bg', 'en']) for (const unit of ['L', 'gal']) for (const w of [320, 360, 412, 600]) {
    const key = `${lang}_${unit}_${w}`;
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 800 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
    await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    await p.goto(BASE);
    await p.evaluate(([st, l, u]) => {
      localStorage.clear();
      localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st));
      localStorage.setItem('aquaAssistantHasData_v1', '1');
      localStorage.setItem('aquaAssistLang', l);
      localStorage.setItem('aquaAssistSeenVersion', '3.6.96');
      localStorage.setItem('aquassist_volume_unit', u);
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T] }, lang, unit]);
    await p.reload(); await p.waitForFunction(() => typeof switchTab === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => { switchTab('aquarium'); updateParamColors(); }); await p.waitForTimeout(200);
    if (unit === 'gal') { await p.evaluate(() => setVolumeUnit('gal')); await p.waitForTimeout(150); }
    const m = await p.evaluate(() => {
      const grid = document.querySelector('#secParams .param-grid');
      const cards = [...grid.querySelectorAll(':scope > .param-card')];
      const r = el => el.getBoundingClientRect();
      // Редове по top на картата
      const rows = {};
      cards.forEach(c => { const k = Math.round(r(c).top); (rows[k] = rows[k] || []).push(c); });
      const rowStats = Object.values(rows).map(cs => {
        const tops = cs.map(c => Math.round(r(c.querySelector('.param-value')).top));
        const stTops = cs.map(c => { const s = c.querySelector('.param-status'); return s ? Math.round(r(s).bottom) : null; }).filter(x => x !== null);
        const heights = cs.map(c => Math.round(r(c).height));
        const titleH = cs.map(c => Math.round(r(c.querySelector('.param-title')).height));
        const iconOk = cs.every(c => { const t = r(c.querySelector('.param-title')); const i = r(c.querySelector('.param-title i')); return i.top >= t.top - 1 && i.bottom <= t.bottom + 1; });
        return { n: cs.length, valueTopSpread: Math.max(...tops) - Math.min(...tops), heightSpread: Math.max(...heights) - Math.min(...heights), statusBottomSpread: stTops.length ? Math.max(...stTops) - Math.min(...stTops) : 0, titleHeights: titleH, iconInside: iconOk };
      });
      const valueOverflow = [...document.querySelectorAll('#secParams .param-value')].some(v => v.scrollWidth > v.clientWidth + 1);
      const co2 = document.getElementById('co2Box');
      const co2Badge = document.getElementById('co2Badge');
      const co2Ok = co2.classList.contains('hidden') ? 'hidden' : (co2Badge.getBoundingClientRect().width > 0 ? 'visible' : 'none');
      return {
        rowStats, valueOverflow,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        co2: co2Ok
      };
    });
    out[key] = m;
    m.rowStats.forEach((rs, i) => {
      check(rs.valueTopSpread <= 1, `${key} ред ${i}: стойностите не са на една височина (${rs.valueTopSpread}px)`);
      check(rs.heightSpread <= 1, `${key} ред ${i}: картите са с различна височина (${rs.heightSpread}px)`);
      check(rs.statusBottomSpread <= 1, `${key} ред ${i}: статусите не са на едно място (${rs.statusBottomSpread}px)`);
      check(rs.iconInside, `${key} ред ${i}: иконата е извън заглавието`);
    });
    check(!m.valueOverflow, `${key}: стойност излиза от картата`);
    check(m.pageOverflow <= 0, `${key}: хоризонтално превъртане (${m.pageOverflow}px)`);
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
