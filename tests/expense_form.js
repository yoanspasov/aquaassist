// Проверка на формата за разходи (Финансов дневник) и празните избори в падащите менюта.
// Пускане: node tests/expense_form.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9431;
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

const OLD = [
  { t: new Date(2026, 10, 1, 12).getTime(), category: 'Храна', desc: 'стар', amount: 5 },
  { t: new Date(2026, 10, 2, 12).getTime(), category: 'Тестове', desc: '', amount: 12.5 }
];
const T = { name: 'B', aqType: 'Общ аквариум (Community)', aqLiters: '100', temp: '25', ph: '7', fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: OLD, dosing: [] };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = {}; const fail = [];
  const check = (c, m) => { if (!c) fail.push(m); };
  const MSG = {
    bg: { noCat: 'Избери категория.', both: 'Избери категория и въведи сума.', amount: 'Въведи валидна сума.' },
    en: { noCat: 'Choose a category.', both: 'Choose a category and enter an amount.', amount: 'Enter a valid amount.' }
  };
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
      localStorage.setItem('aquaAssistSeenVersion', '3.6.92');
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T] }, lang]);
    await p.reload(); await p.waitForFunction(() => typeof addExpense === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => { switchTab('more'); });
    const cat = () => p.evaluate(() => document.getElementById('expenseCategory').value);
    const count = () => p.evaluate(() => store.tanks[store.active].expenses.length);
    const toastHas = (s) => p.evaluate(s => document.body.innerText.includes(s), s);
    const add = async () => { await p.evaluate(() => addExpense()); await p.waitForTimeout(150); };
    const fill = async (c, a, d) => {
      await p.evaluate(v => { document.getElementById('expenseCategory').value = v; }, c || '');
      await p.evaluate(v => { document.getElementById('expenseAmount').value = v; }, a === undefined ? '' : String(a));
      await p.evaluate(v => { document.getElementById('expenseDesc').value = v; }, d || '');
    };
    const L = MSG[lang];
    // 1) По подразбиране: празен избор
    out[lang + ' default'] = { value: await cat(), text: await p.evaluate(() => document.getElementById('expenseCategory').selectedOptions[0].textContent), selIndex: await p.evaluate(() => document.getElementById('expenseCategory').selectedIndex) };
    check(out[lang + ' default'].value === '' && out[lang + ' default'].selIndex === 0, lang + ': категорията не е празният избор');
    check(out[lang + ' default'].text === (lang === 'bg' ? '— Избери —' : '— Select —'), lang + ': текстът на празния избор е грешен');
    // 2) Без категория, със сума -> блокира
    const before = await count();
    await fill('', 10); await add();
    out[lang + ' no_category'] = { added: (await count()) - before, toast: await toastHas(L.noCat) };
    check(out[lang + ' no_category'].added === 0 && out[lang + ' no_category'].toast, lang + ': без категория не блокира');
    // 3) Без категория и без сума -> общото съобщение
    await fill('', ''); await add();
    out[lang + ' none'] = { added: (await count()) - before, toast: await toastHas(L.both) };
    check(out[lang + ' none'].added === 0 && out[lang + ' none'].toast, lang + ': общото съобщение липсва');
    // 4) Категория, но сумата е празна, 0 или отрицателна -> блокира
    for (const a of ['', 0, -5]) {
      await fill('Храна', a); await add();
      out[lang + ' amount_' + a] = { added: (await count()) - before, toast: await toastHas(L.amount) };
      check(out[lang + ' amount_' + a].added === 0 && out[lang + ' amount_' + a].toast, `${lang}: сума "${a}" не е блокирана`);
    }
    // 5) Валидно: записва, нулира формата
    await fill('Риби', 7.5, 'тест');
    await add();
    const added = await p.evaluate(() => store.tanks[store.active].expenses.slice(-1)[0]);
    out[lang + ' valid'] = { added: (await count()) - before, entry: { category: added.category, desc: added.desc, amount: added.amount }, afterCat: await cat(), afterAmount: await p.evaluate(() => document.getElementById('expenseAmount').value), afterDesc: await p.evaluate(() => document.getElementById('expenseDesc').value) };
    check(out[lang + ' valid'].added === 1 && added.category === 'Риби' && added.amount === 7.5, lang + ': валидният разход не се записа');
    check(out[lang + ' valid'].afterCat === '' && out[lang + ' valid'].afterAmount === '' && out[lang + ' valid'].afterDesc === '', lang + ': формата не се нулира');
    // 6) Описание по избор
    await fill('Друго', 3); await add();
    out[lang + ' no_desc'] = { added: (await count()) - before, last: await p.evaluate(() => store.tanks[store.active].expenses.slice(-1)[0].desc) };
    check(out[lang + ' no_desc'].added === 2 && out[lang + ' no_desc'].last === '', lang + ': описанието не е по избор');
    // 7) Старите разходи не са променени
    out[lang + ' old_unchanged'] = await p.evaluate(old => JSON.stringify(store.tanks[store.active].expenses.slice(0, 2)) === JSON.stringify(old), OLD);
    check(out[lang + ' old_unchanged'], lang + ': старите разходи са променени');
    // 8) Презареждане: данните остават, формата започва с празния избор
    await p.reload(); await p.waitForFunction(() => typeof addExpense === 'function'); await p.waitForTimeout(300);
    out[lang + ' after_reload'] = { value: await cat(), count: await p.evaluate(() => store.tanks[store.active].expenses.length) };
    check(out[lang + ' after_reload'].value === '' && out[lang + ' after_reload'].count === 4, lang + ': след презареждане не е както трябва');
    // 9) Други избори по подразбиране: отчет за бъг и филтър на рутинната поддръжка
    await p.evaluate(() => { switchTab('more'); });
    out[lang + ' bug_tab_default'] = await p.evaluate(() => document.getElementById('bugTabSelect').value);
    check(out[lang + ' bug_tab_default'] === '', lang + ': отчетът за бъг не започва с празния избор');
    out[lang + ' filter_default'] = await p.evaluate(() => { const s = document.getElementById('wcFilterSel'); return s ? s.value : null; });
    out[lang + ' errors'] = errs;
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
