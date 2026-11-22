// Проверка за български текст при английски език (AquaAssist).
// Пускане: node tests/en_scan.js
// Нужен е Playwright (playwright-core) и Microsoft Edge. Ако пакетът не се намира,
// задай променлива PLAYWRIGHT_CORE към пътя до пакета (например папка с node_modules/playwright-core).
// Скриптът НЕ записва нищо в проекта; използва временен localStorage в браузъра.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const DIR = path.join(__dirname, '..');
const PORT = 9411;
const BASE = `http://localhost:${PORT}/`;
const CYR = /[А-Яа-я]/;
const DAY = 86400000;

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

// Три аквариума: нисък, добър и висок CO2 (CO2 = 3 × KH × 10^(7 − pH)), с предупреждения за съвместимост и обем
const fish = (name, count) => ({ name, count, note: '', noteAt: 0, addedAt: 0, updatedAt: 0 });
const tank = (name, ph, kh, fishList) => ({
  name, aqType: 'Общ аквариум (Community)', aqLiters: '100', temp: '25', ph: String(ph), kh: String(kh),
  nh3: '0', no2: '0', no3: '10', gh: '6', cl2: '0', fish: fishList,
  history: [0, 1, 2].map(i => ({ t: Date.now() - (3 - i) * DAY, temp: 25, ph, nh3: 0, no2: 0, no3: 10 + i, gh: 6, kh, cl2: 0 })),
  waterChangeLog: [{ t: Date.now() - 3 * DAY, percent: 25, liters: 25 }],
  maintenanceLog: [{ id: 'taskFilter', label: 'Почистване на филтър', t: Date.now() - 2 * DAY }],
  inhabitantLog: [{ name: 'Гупи (Guppy)', type: 'Риба', action: 'added', count: 3, t: Date.now() - DAY }],
  timeline: [], expenses: [{ t: Date.now() - DAY, amount: 5, cat: 'food', note: 'Храна' }], dosing: [],
  equipmentItems: [
    { id: 'eq1', type: 'filter', model: 'Филтър X', params: '', bought: '', serviced: '', notes: '', customName: '' },
    { id: 'eq2', type: 'lamp', model: 'Лампа Y', params: '10 W', bought: '', serviced: '', notes: '', customName: '' }
  ]
});
const SEED = {
  schemaVersion: 1, theme: 'ocean', active: 0,
  tanks: [
    tank('Low CO2', 7.5, 1, [fish('Гупи (Guppy)', 3), fish('Бета (Боен рибок)', 1), fish('Скарида Ред Чери (Red Cherry)', 5), fish('Дискус (Discus)', 2)]),
    tank('Good CO2', 7, 4, [fish('Гупи (Guppy)', 3)]),
    tank('High CO2', 6.5, 4, [fish('Гупи (Guppy)', 3)])
  ]
};

// Текстове, въведени от потребителя (не са превод): не се броят
const USER_DATA = ['Филтър X', 'Лампа Y'];
const found = {}; // състояние -> уникални текстове с кирилица
const note = (state, items) => {
  items = items.filter(it => !USER_DATA.some(u => it.startsWith(u)));
  items.forEach(it => { if (!found[state]) found[state] = new Set(); found[state].add(it); });
};

// Събира видимите текстове (и атрибутите title/placeholder/aria-label) с кирилица
async function scan(p, state) {
  let items = await p.evaluate(() => {
    const out = [];
    const cyr = /[А-Яа-я]/;
    const visible = el => !!(el.offsetParent || el.getClientRects().length);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || /SCRIPT|STYLE|NOSCRIPT/.test(el.tagName)) continue;
      const t = n.textContent.trim();
      if (!t || !cyr.test(t)) continue;
      if (!(visible(el) || el.closest('.sr-only'))) continue;
      out.push(t.slice(0, 120) + '  [' + (el.id ? '#' + el.id : el.tagName.toLowerCase()) + ']');
    }
    document.querySelectorAll('[title],[placeholder],[aria-label]').forEach(el => {
      if (!visible(el)) return;
      ['title', 'placeholder', 'aria-label'].forEach(a => {
        const v = el.getAttribute(a);
        if (v && cyr.test(v)) out.push('@' + a + ': ' + v.slice(0, 120) + '  [' + (el.id ? '#' + el.id : el.tagName.toLowerCase()) + ']');
      });
    });
    return out;
  });
  note(state, items);
}

async function newPage(lang, seed) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => note('pageerror', [String(e.message || e)]));
  await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await p.goto(BASE);
  await p.evaluate(([st, l]) => {
    localStorage.clear();
    localStorage.setItem('aquaAssistantState_v2', JSON.stringify(st));
    localStorage.setItem('aquaAssistantHasData_v1', '1');
    localStorage.setItem('aquaAssistLang', l);
    localStorage.setItem('aquaAssistSeenVersion', '0.0.0');
  }, [seed, lang]);
  await p.reload();
  await p.waitForFunction(() => typeof switchTab === 'function' && typeof setLanguage === 'function');
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.showAppConfirm = (m) => { window.__confirmMsg = m; return Promise.resolve(true); }; });
  return { ctx, p };
}

async function visitStates(p, prefix) {
  const tabs = ['home', 'aquarium', 'add', 'history', 'inhabitants', 'encyclopedia', 'more'];
  for (const t of tabs) {
    await p.evaluate(tb => switchTab(tb), t); await p.waitForTimeout(150);
    await scan(p, prefix + ' tab:' + t);
  }
  // Начало: три аквариума = три нива на CO2
  await p.evaluate(() => switchTab('home'));
  for (let i = 0; i < 3; i++) {
    await p.evaluate(i => { store.active = i; applyTank(); refreshAfterTankChange(); }, i);
    await p.waitForTimeout(150);
    await scan(p, prefix + ' home-co2-tank' + i);
  }
  await p.evaluate(() => { store.active = 0; applyTank(); refreshAfterTankChange(); });
  // Предупреждения за съвместимост и обем (таб Обитатели)
  await p.evaluate(() => switchTab('inhabitants')); await p.waitForTimeout(150);
  await scan(p, prefix + ' inhabitants-warnings');
  // Сравнение
  await p.evaluate(() => { switchTab('inhabitants'); const b = document.getElementById('compareBody'); if (b.classList.contains('hidden')) toggleCompare(); });
  await p.waitForTimeout(200);
  await scan(p, prefix + ' compare');
  await p.evaluate(() => { const b = document.getElementById('compareBody'); if (!b.classList.contains('hidden')) toggleCompare(); });
  // Добави: кандидат за вид с предупреждения (съвместимост, обем)
  await p.evaluate(() => { switchTab('add'); const sel = document.getElementById('animalSelect'); if (sel) { const i = [...sel.options].findIndex(o => /Дискус|Discus/.test(o.textContent)); if (i >= 0) sel.selectedIndex = i; try { showAnimalDetails(); } catch (e) {} } });
  await p.waitForTimeout(150);
  await scan(p, prefix + ' add-candidate');
  // Енциклопедия: карта на вид
  await p.evaluate(() => switchTab('encyclopedia')); await p.waitForTimeout(150);
  await p.evaluate(() => { try { showAnimalDetails(); } catch (e) {} });
  await scan(p, prefix + ' encyclopedia-card');
  // Още: синхронизация, QR, данни
  await p.evaluate(() => switchTab('more')); await p.waitForTimeout(150);
  await p.evaluate(() => { try { toggleQR(); } catch (e) {} }); await p.waitForTimeout(300);
  await scan(p, prefix + ' more-qr');
  await p.evaluate(() => { try { toggleQR(); } catch (e) {} });
  // Диагностика със симптоми
  await p.evaluate(() => { try { openDiagnosisModal(); } catch (e) {} }); await p.waitForTimeout(200);
  await scan(p, prefix + ' diagnosis-empty');
  await p.evaluate(() => { try { const b = document.querySelector('#diagnosisModal input[type=checkbox], #diagnosisModal button'); if (b) b.click(); } catch (e) {} });
  await p.waitForTimeout(200);
  await scan(p, prefix + ' diagnosis-picked');
  await p.evaluate(() => { try { document.getElementById('diagnosisModal').classList.add('hidden'); } catch (e) {} });
  // Доклад за бъг
  await p.evaluate(() => { try { openReportBugModal(); } catch (e) {} }); await p.waitForTimeout(150);
  await scan(p, prefix + ' bug-report');
  await p.evaluate(() => { try { document.getElementById('bugReportModal').classList.add('hidden'); } catch (e) {} });
  // Име на аквариум
  await p.evaluate(() => { try { openTankNameModal(); } catch (e) {} }); await p.waitForTimeout(150);
  await scan(p, prefix + ' tank-name-modal');
  await p.evaluate(() => { try { closeTankNameModal(); } catch (e) {} });
  // Настройки
  await p.evaluate(() => { const s = document.getElementById('settingsPanel'); if (s.classList.contains('hidden')) toggleSettingsPanel(); });
  await p.waitForTimeout(150);
  await scan(p, prefix + ' settings');
  await p.evaluate(() => { const s = document.getElementById('settingsPanel'); if (!s.classList.contains('hidden')) toggleSettingsPanel(); });
  // Съобщения, потвърждения, банер за обновяване
  await p.evaluate(() => { showToast('Параметрите са запазени.'); showToast('Въведи число по-голямо от 0.', 'warn'); }); await p.waitForTimeout(200);
  await scan(p, prefix + ' toasts');
  await p.evaluate(() => { showAppAlert('Параметрите са запазени.', 'info'); }); await p.waitForTimeout(150);
  await scan(p, prefix + ' app-alert');
  await p.evaluate(() => { document.querySelectorAll('#appAlertModal button, #appAlertOk, [id*="Alert"] button').forEach(b => b.click()); });
  await p.evaluate(() => { showAppConfirm('Изтриване?', 'error', 'Изтрий'); }); await p.waitForTimeout(150);
  await scan(p, prefix + ' app-confirm');
  await p.evaluate(() => { document.querySelectorAll('#appConfirmModal button').forEach(b => b.click()); }); await p.waitForTimeout(100);
  await p.evaluate(() => { showAppUpdateBanner({ waiting: null }); }); await p.waitForTimeout(150);
  await scan(p, prefix + ' update-banner');
  await p.evaluate(() => { const b = document.getElementById('appUpdateBanner'); if (b) b.remove(); });
  await p.evaluate(() => switchTab('home')); await p.waitForTimeout(100);
}

let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  // 1) Английски от началото: всички състояния
  let s = await newPage('en', SEED);
  await visitStates(s.p, 'EN');
  await s.p.evaluate(() => { try { checkWhatsNew(); } catch (e) {} }); await s.p.waitForTimeout(200);
  await scan(s.p, 'EN whats-new');
  await s.ctx.close();

  // 2) Български -> английски при отворен екран (смяна на езика без презареждане)
  const switchSteps = [
    ['home', p => p.evaluate(() => { store.active = 0; applyTank(); refreshAfterTankChange(); })],
    ['settings', p => p.evaluate(() => { const x = document.getElementById('settingsPanel'); if (x.classList.contains('hidden')) toggleSettingsPanel(); })],
    ['bug-report', p => p.evaluate(() => openReportBugModal())],
    ['diagnosis', p => p.evaluate(() => { document.getElementById('bugReportModal') && document.getElementById('bugReportModal').classList.add('hidden'); openDiagnosisModal(); })],
    ['update-banner', p => p.evaluate(() => showAppUpdateBanner({ waiting: null }))],
    ['toast', p => p.evaluate(() => showToast('Параметрите са запазени.'))]
  ];
  s = await newPage('bg', SEED);
  for (const [name, open] of switchSteps) {
    await open(s.p); await s.p.waitForTimeout(150);
    await s.p.evaluate(() => setLanguage('en')); await s.p.waitForTimeout(200);
    await scan(s.p, 'SWITCH bg->en at ' + name);
    await s.p.evaluate(() => setLanguage('bg')); await s.p.waitForTimeout(150);
    await s.p.evaluate(() => { document.querySelectorAll('.aqua-toast').forEach(e => e.remove()); });
  }
  await s.ctx.close();

  // Резултат: текстове на български при английски език
  const report = {};
  Object.keys(found).forEach(k => { if (found[k].size) report[k] = [...found[k]]; });
  const total = Object.values(report).reduce((a, b) => a + b.length, 0);
  console.log(JSON.stringify({ total, report }, null, 1));
  await browser.close();
  srv.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
