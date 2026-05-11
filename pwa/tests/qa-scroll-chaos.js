/**
 * Scroll chaos test — every tab, every viewport, every scroll surface.
 * Goal: find why scroll feels weird across the whole app, not just Chat.
 *
 * For each tab and each viewport:
 *   - Measure: body height, screen height, screen overflow, scrollable elements
 *   - Try: wheel events at top/middle/bottom, touch drags, programmatic scroll
 *   - Record: what actually scrolled vs what visually moved
 *   - Detect: nested scroll containers, conflicting overflow rules, dead zones
 */
const { chromium } = require('playwright');
const fs = require('fs');

const VIEWPORTS = [
  { name: '14Pro', w: 390, h: 844 },
  { name: 'SE',    w: 320, h: 568 },
  { name: 'Plus',  w: 428, h: 926 },
];

const TABS = ['today', 'coach', 'progress', 'settings'];

async function injectData(page) {
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  for (const date of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const aP = `coach/analysis/${date}.json`;
    const lP = `coach/incoming/extracted/daily/${date}/log.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: null };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));
    await page.evaluate(async ({a, userMsgs}) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: userMsgs });
    }, { a, userMsgs });
  }
}

async function measureScrollables(page) {
  return await page.evaluate(() => {
    // Find every scrollable element in the active screen
    const active = document.querySelector('.screen.active');
    if (!active) return { error: 'no active screen' };
    const scrollables = [];
    const walk = (el) => {
      const cs = getComputedStyle(el);
      const overflowY = cs.overflowY;
      const r = el.getBoundingClientRect();
      const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      if (overflowY === 'auto' || overflowY === 'scroll' || canScroll) {
        scrollables.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: (el.className || '').toString().slice(0, 60),
          overflowY,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          overflowsBy: el.scrollHeight - el.clientHeight,
          rect: { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) },
          canScroll,
        });
      }
      for (const c of el.children) walk(c);
    };
    walk(active);
    // Also document/body
    const docOverflowY = getComputedStyle(document.documentElement).overflowY;
    const bodyOverflowY = getComputedStyle(document.body).overflowY;
    return {
      activeId: active.id,
      activeRect: active.getBoundingClientRect(),
      activeOverflowY: getComputedStyle(active).overflowY,
      activeScrollH: active.scrollHeight,
      activeClientH: active.clientHeight,
      docOverflowY,
      bodyOverflowY,
      bodyScrollH: document.body.scrollHeight,
      docScrollH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      winY: window.scrollY,
      scrollables,
      bottomNav: document.querySelector('.bottom-nav')?.getBoundingClientRect(),
      header: document.querySelector('.app-header')?.getBoundingClientRect(),
    };
  });
}

async function tryWheel(page, x, y, dy) {
  const before = await page.evaluate(() => {
    const active = document.querySelector('.screen.active');
    const sc = Array.from(document.querySelectorAll('*')).filter(el => {
      const cs = getComputedStyle(el);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    return {
      winY: window.scrollY,
      activeScroll: active?.scrollTop,
      scTops: sc.map(el => ({ id: el.id || el.className?.toString()?.slice(0,30), st: el.scrollTop })),
    };
  });
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const active = document.querySelector('.screen.active');
    const sc = Array.from(document.querySelectorAll('*')).filter(el => {
      const cs = getComputedStyle(el);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    return {
      winY: window.scrollY,
      activeScroll: active?.scrollTop,
      scTops: sc.map(el => ({ id: el.id || el.className?.toString()?.slice(0,30), st: el.scrollTop })),
    };
  });
  // Compute what moved
  const moved = [];
  if (after.winY !== before.winY) moved.push(`window:${before.winY}→${after.winY}`);
  if (after.activeScroll !== before.activeScroll) moved.push(`active:${before.activeScroll}→${after.activeScroll}`);
  for (const a of after.scTops) {
    const b = before.scTops.find(bb => bb.id === a.id);
    if (b && a.st !== b.st) moved.push(`${a.id}:${b.st}→${a.st}`);
  }
  return moved;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const findings = [];
  const errs = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n╔═══════════════════ ${vp.name} (${vp.w}x${vp.h}) ═══════════════════╗`);
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`[${vp.name}] ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`[${vp.name}] ${m.text().slice(0,150)}`); });

    await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
    await injectData(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    for (const tab of TABS) {
      console.log(`\n  ── Tab: ${tab} ──`);
      await page.locator(`.nav-item[data-screen="${tab}"]`).first().click();
      await page.waitForTimeout(800);

      const m = await measureScrollables(page);
      console.log(`     active: ${m.activeId} overflowY=${m.activeOverflowY} clientH=${m.activeClientH} scrollH=${m.activeScrollH}`);
      console.log(`     doc/body overflowY: ${m.docOverflowY}/${m.bodyOverflowY}  body scrollH=${m.bodyScrollH}  win=${m.winH}`);
      console.log(`     scrollables found: ${m.scrollables.length}`);
      for (const s of m.scrollables) {
        console.log(`       - ${s.tag}#${s.id}.${s.cls} overflowY=${s.overflowY} h=${s.clientH}/${s.scrollH} (+${s.overflowsBy}) rect=(${s.rect.t},${s.rect.b})`);
      }

      // Detect issues
      const issues = [];
      // 1. Nested scrolls?
      const realScrollables = m.scrollables.filter(s => s.canScroll);
      if (realScrollables.length > 1) {
        issues.push(`NESTED SCROLLS: ${realScrollables.length} scroll containers compete`);
      }
      // 2. Body scrolling when it shouldn't?
      if (m.bodyScrollH > m.winH + 10) {
        issues.push(`BODY OVERFLOWS WINDOW: body scrollH=${m.bodyScrollH} > winH=${m.winH} — page itself can scroll`);
      }
      // 3. Active screen has content overflow but isn't scrollable?
      if (m.activeScrollH > m.activeClientH + 10 && m.activeOverflowY !== 'auto' && m.activeOverflowY !== 'scroll') {
        issues.push(`CONTENT CUT OFF: active screen has ${m.activeScrollH - m.activeClientH}px overflow but overflowY=${m.activeOverflowY}`);
      }
      // 4. Bottom-nav overlap?
      if (m.bottomNav && m.activeRect) {
        const activeBottom = m.activeRect.bottom;
        const navTop = m.bottomNav.top;
        if (activeBottom > navTop + 5) {
          issues.push(`SCREEN UNDER NAV: screen bottom ${activeBottom} > nav top ${navTop}`);
        }
      }

      // Try wheel events at 3 locations
      const moved1 = await tryWheel(page, vp.w / 2, 100, 200);
      console.log(`     wheel @ (mid, 100px from top) +200: moved=[${moved1.join(', ') || 'NOTHING'}]`);
      // Reset
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll('.screen').forEach(s => s.scrollTop = 0);
      });
      await page.waitForTimeout(150);

      const midY = Math.floor(vp.h / 2);
      const moved2 = await tryWheel(page, vp.w / 2, midY, 200);
      console.log(`     wheel @ (mid, mid) +200: moved=[${moved2.join(', ') || 'NOTHING'}]`);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll('.screen').forEach(s => s.scrollTop = 0);
      });
      await page.waitForTimeout(150);

      const bottomY = vp.h - 100;
      const moved3 = await tryWheel(page, vp.w / 2, bottomY, 200);
      console.log(`     wheel @ (mid, bottom-100) +200: moved=[${moved3.join(', ') || 'NOTHING'}]`);

      if (issues.length) {
        console.log(`     ⚠ ISSUES: ${issues.join(' | ')}`);
        findings.push({ vp: vp.name, tab, issues });
      }

      await page.screenshot({ path: `pwa/tests/screenshots/qa-scroll-chaos/${vp.name}-${tab}.png` });
    }
    await page.close();
    await ctx.close();
  }

  console.log('\n\n══════════════════ SUMMARY ══════════════════');
  if (findings.length === 0) {
    console.log('No structural issues detected. Scroll feel must be from CSS/timing.');
  } else {
    for (const f of findings) {
      console.log(`  [${f.vp}/${f.tab}]`);
      for (const i of f.issues) console.log(`    - ${i}`);
    }
  }
  if (errs.length) {
    console.log('\nJS errors:');
    errs.slice(0, 20).forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo JS errors.');
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
