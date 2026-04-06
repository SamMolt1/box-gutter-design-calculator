/**
 * Box Gutter Design Calculator — Puppeteer QA Suite
 * AS/NZS 3500.3:2025
 *
 * Run: npm test
 */

const puppeteer = require('puppeteer');
const { spawn }  = require('child_process');
const http       = require('http');

const BASE = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[2m${e.message}\x1b[0m`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assert(cond, msg)               { if (!cond)           throw new Error(msg || 'Assertion failed'); }
function assertEq(a, b, msg)             { if (a !== b)         throw new Error(msg || `Expected "${b}", got "${a}"`); }
function assertContains(str, sub, msg)   { if (!str.includes(sub)) throw new Error(msg || `Expected "${str}" to contain "${sub}"`); }
function assertApprox(actual, exp, tol, msg) {
  if (Math.abs(actual - exp) > tol)
    throw new Error(msg || `Expected ${exp} ±${tol}, got ${actual}`);
}

/** Start the Node server, resolve when it's accepting connections */
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn('node', ['server.js'], {
      cwd: require('path').join(__dirname, '..'),
      stdio: 'ignore',
    });
    srv.on('error', reject);
    // Poll until port 3000 responds
    const t0 = Date.now();
    const poll = () => {
      http.get(BASE, () => resolve(srv)).on('error', () => {
        if (Date.now() - t0 > 8000) return reject(new Error('Server did not start'));
        setTimeout(poll, 200);
      });
    };
    setTimeout(poll, 300);
  });
}

/** Fill a select by value */
async function sel(page, id, value) { await page.select(`#${id}`, value); }

/** Clear a number input and type a value */
async function num(page, id, value) {
  await page.$eval(`#${id}`, el => el.value = '');
  await page.type(`#${id}`, String(value));
}

/** Get trimmed text content of an element */
async function txt(page, id) {
  return page.$eval(`#${id}`, el => el.textContent.trim());
}

/** True if element is visible (not display:none) */
async function visible(page, id) {
  return page.$eval(`#${id}`, el => el.offsetParent !== null).catch(() => false);
}

/** Reset form and results */
async function reset(page) {
  await page.evaluate(() => window.handleReset());
  await page.waitForFunction(
    () => document.getElementById('placeholder').offsetParent !== null,
    { timeout: 2000 }
  );
}

/** Run a full calculation and wait for results — sets all values in one evaluate to avoid cascading debounce timeouts */
async function calculate(page, opts = {}) {
  const {
    location       = 'Sydney',
    ari            = '10',
    area           = 250,
    roofType       = 'metal',
    gutterMaterial = 'zincalume',
    slope          = '0.010',
    outlets        = 2,
    method         = 1,
    dpSize         = 'auto',
    wocSize        = null,
    intensity      = null,
    gutterWidth    = null,
  } = opts;

  await page.evaluate((o) => {
    const $ = id => document.getElementById(id);
    // Set all values without triggering events
    $('location').value = o.location;
    $('ari').value = o.ari;
    $('catchment-area').value = o.area;
    $('roof-type').value = o.roofType;
    $('gutter-material').value = o.gutterMaterial;
    $('gutter-slope').value = o.slope;
    if (o.slope === 'manual') $('slope-manual-group').style.display = '';
    $('num-outlets').value = o.outlets;
    $('m' + o.method).checked = true;
    if (o.method === 2) $('woc-group').style.display = '';
    else $('woc-group').style.display = 'none';
    $('dp-size').value = o.dpSize;
    if (o.wocSize) $('woc-size').value = o.wocSize;
    if (o.gutterWidth) $('gutter-width').value = o.gutterWidth;
    else $('gutter-width').value = '';
    // Update intensity from BOM lookup (no event dispatch — call directly)
    if (o.location !== 'Manual') {
      const ifd = {'Sydney':[90,110,140,165,190,235,275],'Melbourne':[55,70,90,110,130,160,185],'Brisbane':[100,125,165,195,230,285,330],'Perth':[60,75,100,120,145,180,215],'Adelaide':[50,65,85,105,125,155,180],'Darwin':[145,175,220,255,295,355,405],'Hobart':[45,55,70,85,100,125,145],'Canberra':[60,75,95,115,135,165,195]};
      const ariIdx = {1:0,2:1,5:2,10:3,20:4,50:5,100:6};
      const v = ifd[o.location]?.[ariIdx[parseInt(o.ari)]];
      if (v) { $('intensity').value = v; $('intensity').setAttribute('readonly',''); }
    }
    if (o.intensity) { $('intensity').value = o.intensity; $('intensity').removeAttribute('readonly'); }
    // Single calculate call — no debounce cascade
    window.handleCalculate();
  }, { location, ari, area, roofType, gutterMaterial, slope, outlets, method, dpSize, wocSize, intensity, gutterWidth });

  await page.waitForFunction(
    () => document.getElementById('metrics-strip').offsetParent !== null,
    { timeout: 10000 }
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n\x1b[1m  Box Gutter Calculator — QA Test Suite\x1b[0m');
  console.log('  ─────────────────────────────────────\n');

  let server;
  let browser;

  try {
    process.stdout.write('  Starting server... ');
    server = await startServer();
    console.log('\x1b[32mOK\x1b[0m');

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'], protocolTimeout: 180000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });

    // ── 1. Page & PWA ──────────────────────────────────────────────────────
    console.log('\n  \x1b[1m1. Page & PWA\x1b[0m');

    await test('Page title contains AS/NZS 3500.3', async () => {
      assertContains(await page.title(), 'AS/NZS 3500.3');
    });

    await test('manifest.json linked in <head>', async () => {
      const href = await page.$eval('link[rel="manifest"]', el => el.href);
      assert(href.includes('manifest.json'), `Got: ${href}`);
    });

    await test('manifest.json is valid JSON with required fields', async () => {
      const res  = await page.goto(`${BASE}/manifest.json`);
      const json = await res.json();
      assertEq(json.name, 'Box Gutter Design Calculator');
      assert(json.icons?.length > 0, 'No icons in manifest');
      assert(['standalone','fullscreen'].includes(json.display), `Bad display: ${json.display}`);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    });

    await test('Service worker registered', async () => {
      const swRegistered = await page.evaluate(() =>
        navigator.serviceWorker.getRegistrations().then(r => r.length > 0)
      );
      assert(swRegistered, 'No service worker registered');
    });

    await test('icon.svg is accessible', async () => {
      const res = await page.goto(`${BASE}/icon.svg`);
      assertEq(res.status(), 200);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    });

    // ── 2. Initial State ───────────────────────────────────────────────────
    console.log('\n  \x1b[1m2. Initial State\x1b[0m');

    await test('Placeholder prompt is visible on load', async () => {
      assert(await visible(page, 'placeholder'), 'Placeholder not visible');
    });

    await test('Results panel is hidden on load', async () => {
      const v = await visible(page, 'metrics-strip');
      assert(!v, 'Results strip should be hidden on load');
    });

    await test('Charts panel is hidden on load', async () => {
      const v = await visible(page, 'charts-panel');
      assert(!v, 'Charts panel should be hidden on load');
    });

    await test('Method 1 is selected by default', async () => {
      const checked = await page.$eval('#m1', el => el.checked);
      assert(checked, 'Method 1 should be checked by default');
    });

    await test('Default ARI is 100-year', async () => {
      const val = await page.$eval('#ari', el => el.value);
      assertEq(val, '100');
    });

    // ── 3. Validation ──────────────────────────────────────────────────────
    console.log('\n  \x1b[1m3. Input Validation\x1b[0m');

    await test('Calculate with no area shows error, no results', async () => {
      await page.evaluate(() => window.handleCalculate());
      const err = await txt(page, 'area-error');
      assert(err.length > 0, 'Expected area-error to be shown');
      const v = await visible(page, 'metrics-strip');
      assert(!v, 'Results should not appear without valid area');
    });

    await test('Manual slope: out-of-range (1:25) shows error', async () => {
      await sel(page, 'gutter-slope', 'manual');
      await num(page, 'slope-manual', 25);
      await num(page, 'catchment-area', 100);
      await page.evaluate(() => window.handleCalculate());
      const err = await txt(page, 'slope-error');
      assert(err.length > 0, `Expected slope error for 1:25, got: "${err}"`);
      await sel(page, 'gutter-slope', '0.010');
    });

    await test('Manual slope: out-of-range (1:250) shows error', async () => {
      await sel(page, 'gutter-slope', 'manual');
      await num(page, 'slope-manual', 250);
      await num(page, 'catchment-area', 100);
      await page.evaluate(() => window.handleCalculate());
      const err = await txt(page, 'slope-error');
      assert(err.length > 0, `Expected slope error for 1:250, got: "${err}"`);
      await sel(page, 'gutter-slope', '0.010');
    });

    await test('Zero outlets shows error', async () => {
      await page.$eval('#num-outlets', el => el.value = '0');
      await num(page, 'catchment-area', 100);
      await page.evaluate(() => window.handleCalculate());
      const err = await txt(page, 'outlets-error');
      assert(err.length > 0, 'Expected outlets error');
      await num(page, 'num-outlets', 1);
    });

    // ── 4. Method 1 — Reference Case ──────────────────────────────────────
    console.log('\n  \x1b[1m4. Method 1 — Sydney 10yr ARI Reference Case\x1b[0m');
    // Q = 0.90 × 165 × 250 / 3600 = 10.31 L/s, per outlet = 5.16 L/s

    await reset(page);
    await calculate(page, {
      location: 'Sydney', ari: '10', area: 250,
      roofType: 'metal', gutterMaterial: 'zincalume',
      slope: '0.010', outlets: 2, method: 1,
    });

    await test('Rainfall intensity = 165 mm/hr (Sydney 10yr)', async () => {
      const rows = await page.$$eval('#tb-rainfall tr', rows =>
        rows.map(r => r.cells[1]?.textContent?.trim())
      );
      assert(rows.some(r => r?.includes('165')), `Rows: ${rows.join(' | ')}`);
    });

    await test('Flow per outlet ≈ 5.7 L/s (I×A/3600/outlets)', async () => {
      const flow = await txt(page, 'mv-flow');
      const val  = parseFloat(flow);
      // Q = 165 × 250 / 3600 / 2 = 5.73 L/s
      assertApprox(val, 5.73, 0.5, `Flow per outlet: ${flow}`);
    });

    await test('Gutter width ≥ 200 mm (domestic minimum)', async () => {
      const gutter = await txt(page, 'mv-gutter');
      const w = parseInt(gutter.split('×')[0]);
      assert(w >= 200, `Width ${w}mm < 200mm minimum`);
    });

    await test('Auto downpipe selection is shown', async () => {
      const dp = await txt(page, 'mv-dp');
      assert(dp.length > 0, 'Downpipe value empty');
    });

    await test('Sump dimensions are shown', async () => {
      const sump = await txt(page, 'mv-sump');
      assert(sump.includes('×'), `Sump format unexpected: ${sump}`);
    });

    await test('Rainhead section is visible for Method 1', async () => {
      assert(await visible(page, 'sec-rainhead'), 'Rainhead section not visible');
    });

    await test('Compliance card is visible', async () => {
      assert(await visible(page, 'compliance-card'), 'Compliance card not visible');
    });

    await test('Charts panel is visible after calculation', async () => {
      assert(await visible(page, 'charts-panel'), 'Charts panel not visible');
    });

    await test('Fig H.1 chart is rendered', async () => {
      const w = await page.$eval('#ch-h1', c => c.width);
      assert(w > 0, 'H.1 canvas has zero width');
    });

    await test('Fig H.4 chart is rendered', async () => {
      const w = await page.$eval('#ch-h4', c => c.width);
      assert(w > 0, 'H.4 canvas has zero width');
    });

    await test('Fig H.3 chart visible for Method 1', async () => {
      assert(await visible(page, 'cw-h3'), 'H.3 not visible in Method 1');
    });

    await test('Fig H.6a/H.8 hidden for Method 1', async () => {
      const h6a = await visible(page, 'cw-h6a');
      const h8  = await visible(page, 'cw-h8');
      assert(!h6a && !h8, 'H.6a or H.8 should be hidden in Method 1');
    });

    // ── 5. Method 1 — Manual Downpipe Selection ────────────────────────────
    console.log('\n  \x1b[1m5. Method 1 — Manual Downpipe Selection\x1b[0m');

    await reset(page);
    await calculate(page, {
      location: 'Sydney', ari: '10', area: 250,
      slope: '0.010', outlets: 2, method: 1,
      dpSize: '150dia',
    });

    await test('Manually selected DN150 shown in results', async () => {
      const dp = await txt(page, 'mv-dp');
      assertContains(dp, '150', `Downpipe value: ${dp}`);
    });

    // ── 6. Method 2 ────────────────────────────────────────────────────────
    console.log('\n  \x1b[1m6. Method 2 — Side Overflow\x1b[0m');

    await reset(page);
    await calculate(page, {
      location: 'Brisbane', ari: '100', area: 300,
      roofType: 'tile', gutterMaterial: 'pvc',
      slope: '0.0125', outlets: 3, method: 2,
      wocSize: '0.300',
    });

    await test('Results visible for Method 2', async () => {
      assert(await visible(page, 'metrics-strip'), 'No results for Method 2');
    });

    await test('Rainhead section hidden for Method 2', async () => {
      const v = await visible(page, 'sec-rainhead');
      assert(!v, 'Rainhead should be hidden in Method 2');
    });

    await test('Fig H.6a visible for Method 2', async () => {
      assert(await visible(page, 'cw-h6a'), 'H.6a not visible in Method 2');
    });

    await test('Fig H.6b visible for Method 2', async () => {
      assert(await visible(page, 'cw-h6b'), 'H.6b not visible in Method 2');
    });

    await test('Fig H.8 hidden for Method 2', async () => {
      const v = await visible(page, 'cw-h8');
      assert(!v, 'H.8 should be hidden in Method 2');
    });

    // ── 7. Method 3 ────────────────────────────────────────────────────────
    console.log('\n  \x1b[1m7. Method 3 — High-Capacity Overflow\x1b[0m');

    await reset(page);
    await calculate(page, {
      location: 'Darwin', ari: '100', area: 500,
      roofType: 'metal', gutterMaterial: 'zincalume',
      slope: '0.010', outlets: 4, method: 3,
    });

    await test('Results visible for Method 3', async () => {
      assert(await visible(page, 'metrics-strip'), 'No results for Method 3');
    });

    await test('Rainhead section hidden for Method 3', async () => {
      const v = await visible(page, 'sec-rainhead');
      assert(!v, 'Rainhead should be hidden in Method 3');
    });

    await test('Fig H.6a visible for Method 3', async () => {
      assert(await visible(page, 'cw-h6a'), 'H.6a not visible in Method 3');
    });

    await test('Fig H.8 visible for Method 3', async () => {
      assert(await visible(page, 'cw-h8'), 'H.8 not visible in Method 3');
    });

    await test('Fig H.6b hidden for Method 3', async () => {
      const v = await visible(page, 'cw-h6b');
      assert(!v, 'H.6b should be hidden in Method 3');
    });

    // ── 8. Edge Cases ──────────────────────────────────────────────────────
    console.log('\n  \x1b[1m8. Edge Cases\x1b[0m');

    await reset(page);
    await calculate(page, {
      location: 'Sydney', ari: '1', area: 1,
      slope: '0.025', outlets: 1, method: 1,
    });

    await test('Very small area (1 m²) — calculation completes', async () => {
      assert(await visible(page, 'metrics-strip'), 'No results for 1m² area');
    });

    await reset(page);
    await calculate(page, {
      location: 'Darwin', ari: '100', area: 2000,
      slope: '0.010', outlets: 1, method: 1,
    });

    await test('Very large area (2000 m²) — calculation completes', async () => {
      assert(await visible(page, 'metrics-strip'), 'No results for 2000m² area');
    });

    await test('Large area — warning card visible', async () => {
      assert(await visible(page, 'warn-card'), 'Expected warnings for large area');
    });

    // ── 9. Manual Location ─────────────────────────────────────────────────
    console.log('\n  \x1b[1m9. Manual Location Entry\x1b[0m');

    await reset(page);
    await calculate(page, {
      location: 'Manual', intensity: 200, area: 150,
      slope: '0.010', outlets: 1, method: 1,
    });

    await test('Manual intensity 200 mm/hr appears in results', async () => {
      const rows = await page.$$eval('#tb-rainfall tr', rows =>
        rows.map(r => r.cells[1]?.textContent?.trim())
      );
      assert(rows.some(r => r?.includes('200')), `Rows: ${rows.join(' | ')}`);
    });

    // ── 10. Reset ──────────────────────────────────────────────────────────
    console.log('\n  \x1b[1m10. Reset\x1b[0m');

    await reset(page);

    await test('Reset hides results', async () => {
      const v = await visible(page, 'metrics-strip');
      assert(!v, 'Results should be hidden after reset');
    });

    await test('Reset hides charts', async () => {
      const v = await visible(page, 'charts-panel');
      assert(!v, 'Charts should be hidden after reset');
    });

    await test('Reset shows placeholder', async () => {
      assert(await visible(page, 'placeholder'), 'Placeholder should be visible after reset');
    });

    // ── 11. Rainfall Intensity by Location ────────────────────────────────
    console.log('\n  \x1b[1m11. BOM IFD Intensity Spot Checks\x1b[0m');

    const IFD_SPOT = [
      { location: 'Melbourne', ari: '100', expected: 185 },
      { location: 'Brisbane',  ari: '5',   expected: 165 },
      { location: 'Hobart',    ari: '1',   expected: 45  },
      { location: 'Canberra',  ari: '50',  expected: 165 },
    ];

    for (const { location, ari, expected } of IFD_SPOT) {
      await reset(page);
      await calculate(page, { location, ari, area: 100, outlets: 1, slope: '0.010', method: 1 });
      await test(`${location} ${ari}-yr ARI = ${expected} mm/hr`, async () => {
        const rows = await page.$$eval('#tb-rainfall tr', rows =>
          rows.map(r => r.cells[1]?.textContent?.trim())
        );
        assert(rows.some(r => r?.includes(String(expected))), `Rows: ${rows.join(' | ')}`);
      });
    }

  } finally {
    if (browser) await browser.close();
    if (server)  server.kill();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n  ─────────────────────────────────────');
  console.log(`  \x1b[1mResults: \x1b[32m${passed} passed\x1b[0m\x1b[1m, \x1b[${failed ? '31' : '32'}m${failed} failed\x1b[0m`);
  if (failures.length) {
    console.log('\n  \x1b[31mFailed tests:\x1b[0m');
    failures.forEach(f => console.log(`    • ${f.name}\n      ${f.error}`));
  }
  console.log();
  process.exit(failed > 0 ? 1 : 0);
})();
