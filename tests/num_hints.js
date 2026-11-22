// Проверка на бледите подсказки (placeholder) в полетата за число.
// Част 1: сумата на разход (бледа нула, ярък текст, валидация, нулиране) — български и английски.
// Част 2: одит на всички числови полета (само отчет, нищо не се променя).
// Пускане: node tests/num_hints.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9441;
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

const T = { name: 'C', aqType: 'Общ аквариум (Community)', aqLiters: '100', temp: '25', ph: '7', fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: [] };
const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const lang of ['bg', 'en']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 360, height: 800 } });
    const p = await ctx.newPage();
    await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    await p.goto(BASE);
    await p.evaluate(([st, l]) => {
      localStorage.clear();
      localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st));
      localStorage.setItem('aquaAssistantHasData_v1', '1');
      localStorage.setItem('aquaAssistLang', l);
      localStorage.setItem('aquaAssistSeenVersion', '3.6.93');
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T] }, lang]);
    await p.reload(); await p.waitForFunction(() => typeof addExpense === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('more')); await p.waitForTimeout(150);
    const style = id => p.evaluate(i => {
      const el = document.getElementById(i);
      const cs = getComputedStyle(el), ps = getComputedStyle(el, '::placeholder');
      return { value: el.value, placeholder: el.placeholder, ph: ps.color, phOpacity: ps.opacity, font: cs.fontSize, color: cs.color, hasClass: el.classList.contains('num-hint') };
    }, id);
    const K = lang;
    // 1) Празно поле: бледа нула, реално празно
    const empty = await style('expenseAmount');
    out[K + ' expense_empty'] = empty;
    check(empty.value === '' && empty.placeholder === '0', K + ': сумата не е празна с подсказка 0');
    const ref = await style('waterChangePct');
    check(empty.ph === ref.ph && empty.font === ref.font && empty.phOpacity === ref.phOpacity, K + ': подсказката на сумата не е като на "% сменена"');
    // 2) Въведено число: ярък цвят, същият като останалите
    await p.fill('#expenseAmount', '12'); await p.waitForTimeout(80);
    const typed = await style('expenseAmount');
    const refTyped = await p.evaluate(() => getComputedStyle(document.getElementById('aqLength')).color);
    out[K + ' expense_typed'] = { color: typed.color, pctTypedColor: refTyped };
    check(typed.color === refTyped && typed.color !== empty.ph, K + ': въведеното число не е с нормалния цвят');
    // 3) Празна или 0 сума -> съобщение, нищо не се записва
    const before = await p.evaluate(() => store.tanks[store.active].expenses.length);
    await p.fill('#expenseCategory', 'Храна').catch(() => {});
    await p.evaluate(() => { document.getElementById('expenseCategory').value = 'Храна'; document.getElementById('expenseAmount').value = ''; });
    await p.evaluate(() => addExpense()); await p.waitForTimeout(120);
    const msgEmpty = await p.evaluate(l => document.body.innerText.includes(l === 'bg' ? 'Въведи валидна сума.' : 'Enter a valid amount.'), lang);
    await p.evaluate(() => { document.getElementById('expenseAmount').value = '0'; }); await p.evaluate(() => addExpense()); await p.waitForTimeout(120);
    const after0 = await p.evaluate(() => store.tanks[store.active].expenses.length);
    out[K + ' validation'] = { msgEmpty, added: after0 - before };
    check(msgEmpty && after0 === before, K + ': празна или 0 сума не е блокирана');
    // 4) Валиден разход: записва, полето се нулира и показва бледата нула
    await p.evaluate(() => { document.getElementById('expenseAmount').value = '12'; }); await p.evaluate(() => addExpense()); await p.waitForTimeout(120);
    const afterAdd = await style('expenseAmount');
    const added = await p.evaluate(() => store.tanks[store.active].expenses.slice(-1)[0]);
    out[K + ' add'] = { added: added && added.amount, field: afterAdd.value, placeholder: afterAdd.placeholder, color: afterAdd.color };
    check(added && added.amount === 12 && afterAdd.value === '' && afterAdd.placeholder === '0', K + ': записът или нулирането не са както трябва');
    // 5) Презареждане
    await p.reload(); await p.waitForFunction(() => typeof addExpense === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('more')); await p.waitForTimeout(100);
    const reloaded = await style('expenseAmount');
    out[K + ' reload'] = { value: reloaded.value, placeholder: reloaded.placeholder };
    check(reloaded.value === '' && reloaded.placeholder === '0', K + ': след презареждане не е празно');
    // 6) Етикет на валутата (няма настройка за валута: остава €)
    out[K + ' currency_label'] = await p.evaluate(() => document.querySelector('label[for="expenseAmount"]').innerText);

    // Одит: всички числови полета — само отчет
    if (K === 'bg') {
      out.audit = await p.evaluate(() => {
        const rows = [];
        document.querySelectorAll('input[type=number]').forEach(el => {
          const cs = getComputedStyle(el), ps = getComputedStyle(el, '::placeholder');
          const lbl = el.id && document.querySelector('label[for="' + el.id + '"]');
          rows.push({ id: el.id || '(без id)', placeholder: el.placeholder || '', hint: ps.color, font: cs.fontSize, cls: el.classList.contains('num-hint') ? 'num-hint' : '', label: lbl ? lbl.innerText.slice(0, 40) : '' });
        });
        return rows;
      });
    }
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
