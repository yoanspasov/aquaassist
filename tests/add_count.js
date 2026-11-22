// Проверка на брой/количество при добавяне на риба и растение (таб „Добави“).
// Пускане: node tests/add_count.js   (PLAYWRIGHT_CORE — виж tests/en_scan.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9451;
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

const T = { name: 'D', aqType: 'Общ аквариум (Community)', aqLiters: '100', temp: '25', ph: '7', fish: [], history: [], waterChangeLog: [], maintenanceLog: [], inhabitantLog: [], timeline: [], expenses: [], dosing: [] };
const fail = []; const check = (c, m) => { if (!c) fail.push(m); };
const out = {};
const MSG = { bg: 'Въведи брой, по-голям от 0.', en: 'Enter a count greater than 0.' };

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
      localStorage.setItem('aquaAssistSeenVersion', '3.6.95');
    }, [{ schemaVersion: 1, theme: 'ocean', active: 0, tanks: [T] }, lang]);
    await p.reload(); await p.waitForFunction(() => typeof addAnimalToAquarium === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('add')); await p.waitForTimeout(150);
    const K = lang;
    const field = id => p.evaluate(i => { const el = document.getElementById(i); const cs = getComputedStyle(el), ps = getComputedStyle(el, '::placeholder'); return { value: el.value, placeholder: el.placeholder, ph: ps.color, font: cs.fontSize, num: el.classList.contains('num-hint') }; }, id);
    const pctRef = await p.evaluate(() => { const el = document.getElementById('waterChangePct'); return { ph: getComputedStyle(el, '::placeholder').color, font: getComputedStyle(el).fontSize }; });
    const fam = () => p.evaluate(() => store.tanks[store.active].fish.map(f => [f.name, f.count]));
    const toast = () => p.evaluate(m => document.body.innerText.includes(m), MSG[lang]);
    const pickSpecies = async (kind, rx) => p.evaluate(([k, r]) => {
      const sel = document.getElementById(k === 'plant' ? 'plantSelect' : 'animalSelect');
      const i = [...sel.options].findIndex(o => new RegExp(r).test(o.textContent));
      sel.selectedIndex = i; sel.dispatchEvent(new Event('change'));
      return i;
    }, [kind, rx]);
    const addBtn = kind => p.click(`button[onclick="${kind === 'plant' ? 'addPlantToAquarium' : 'addAnimalToAquarium'}()"]`);
    const setCount = async (id, v) => p.evaluate(([i, val]) => { const el = document.getElementById(i); el.value = val; }, [id, v]);

    // 1) Празно поле с подсказка 0 (рибки), същият стил като процента
    await pickSpecies('animal', 'Guppy|Гупи');
    const a0 = await field('animalCount');
    out[K + ' animal_empty'] = a0;
    check(a0.value === '' && a0.placeholder === '0' && a0.num, K + ': полето за брой не е празно с подсказка 0');
    check(a0.ph === pctRef.ph && a0.font === pctRef.font, K + ': стилът на подсказката не е като на процента');
    // 2) Невалидни стойности: нищо не се добавя, показва се съобщение
    for (const v of ['', '0', '-3', '2.5', 'abc']) {
      await setCount('animalCount', v);
      await addBtn('animal'); await p.waitForTimeout(120);
      const ok = await toast();
      out[K + ' animal_invalid_' + v] = { toast: ok, fish: (await fam()).length };
      check(ok && (await fam()).length === 0, `${K}: "${v}" не е блокирано`);
    }
    // 3) Валидно 1 -> добавя се; после 5 за същия вид -> събира се
    await setCount('animalCount', '1'); await addBtn('animal'); await p.waitForTimeout(150);
    out[K + ' animal_one'] = await fam();
    check(JSON.stringify(await fam()) === JSON.stringify([[(await fam())[0][0], 1]]) && (await fam())[0][1] === 1, K + ': 1 не е добавено');
    const afterAdd = await field('animalCount');
    const sel = await p.evaluate(() => document.getElementById('animalSelect').value);
    const card = await p.evaluate(() => document.getElementById('animalCard').innerText.replace(/\s+/g, ' ').slice(0, 80));
    out[K + ' animal_after_add'] = { field: afterAdd.value, placeholder: afterAdd.placeholder, select: sel, card };
    check(afterAdd.value === '' && afterAdd.placeholder === '0' && sel === '', K + ': след добавяне полето или менюто не са нулирани');
    check(card.length > 0 && !/\b\d+ (бр|pc)/.test(card), K + ': картата не се върна към подсказката');
    await pickSpecies('animal', 'Guppy|Гупи');
    await setCount('animalCount', '5'); await addBtn('animal'); await p.waitForTimeout(150);
    out[K + ' animal_sum'] = await fam();
    check((await fam())[0][1] === 6, K + ': броят не се събра (очаквано 6)');
    // 4) Растение: същото поведение
    await pickSpecies('plant', 'Java Fern|Яванска папрат');
    const p0 = await field('plantCount');
    out[K + ' plant_empty'] = p0;
    check(p0.value === '' && p0.placeholder === '0' && p0.num, K + ': полето за количество не е празно с подсказка 0');
    await setCount('plantCount', '0'); await addBtn('plant'); await p.waitForTimeout(120);
    out[K + ' plant_zero_toast'] = await toast();
    check(await toast(), K + ': нулево количество не е блокирано');
    await setCount('plantCount', '3'); await addBtn('plant'); await p.waitForTimeout(150);
    const pf = await field('plantCount');
    out[K + ' plant_added'] = { fish: await fam(), field: pf.value, placeholder: pf.placeholder };
    check(pf.value === '' && pf.placeholder === '0' && (await fam()).some(x => x[1] === 3), K + ': растението не е добавено или полето не е нулирано');
    // 5) Презареждане: данните и празните полета остават
    await p.reload(); await p.waitForFunction(() => typeof addAnimalToAquarium === 'function'); await p.waitForTimeout(300);
    await p.evaluate(() => switchTab('add')); await p.waitForTimeout(100);
    out[K + ' reload'] = { fish: await fam(), animal: (await field('animalCount')).value, plant: (await field('plantCount')).value };
    check(out[K + ' reload'].animal === '' && out[K + ' reload'].plant === '' && out[K + ' reload'].fish.length === 2, K + ': след презареждане не е както трябва');
    out[K + ' errors'] = errs;
    await ctx.close();
  }
  out.failures = fail;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
