// One-off visual test: does the Today tab's "Tonight" card render the
// ingredients[] array correctly? Loads fixtures, navigates to Today,
// expands the Tonight collapsible, screenshots.

const { chromium } = require('playwright');
const { startServer } = require('./test-server');
const path = require('path');
const fs = require('fs');

const PORT = 8123;
const BASE_URL = `http://localhost:${PORT}/`;
const OUT_DIR = path.join(__dirname, '..', '.claude', 'test-screenshots', 'ingredient-render');

(async () => {
  const srv = await startServer(path.join(__dirname, '..', 'pwa'), PORT);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text()); });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Inject a meal plan that mirrors tonight's real data (with ingredients[])
  const today = await page.evaluate(() => UI.today());
  const mealPlan = {
    generatedDate: today,
    days: [{
      date: today,
      remaining_meal: { name: 'Dinner + supplements', suggestion: 'Salmon sashimi bowl', calories: 540, protein: 72, fiber: 6, prep_time: '5 min' },
      meals: [
        {
          meal: 'lunch', name: 'Cafeteria Dual-Protein Salad (LOGGED)',
          description: 'Grilled beef + chicken over mixed greens.',
          calories: 380, protein: 48, fiber: 4, prep_time: 'cafeteria',
        },
        {
          meal: 'dinner',
          name: 'Salmon Sashimi Bowl with Cauliflower Rice, Artichokes + Egg White Scramble',
          description: 'Scale-weighed sashimi bowl. 5 min assembly.',
          ingredients: [
            { name: 'salmon sashimi', grams: 100, cups: null, cal: 200, protein: 22, fiber: 0, fat: 12 },
            { name: 'cauliflower rice, cooked', grams: 50, cups: 0.5, cal: 13, protein: 1, fiber: 1.5 },
            { name: 'artichoke hearts, canned drained', grams: 85, cups: 0.5, cal: 40, protein: 4, fiber: 4 },
            { name: 'egg whites, liquid', grams: 60, cups: 0.25, cal: 40, protein: 7, fiber: 0 },
            { name: 'sesame oil', grams: 2, tsp: 0.5, cal: 18, protein: 0, fiber: 0, fat: 2 },
            { name: 'ponzu/soy + wasabi + ginger', grams: 5, cal: 5, protein: 0, fiber: 0 },
          ],
          calories: 298, protein: 34, carbs: 12, fat: 14, fiber: 5.5, prep_time: '5 min',
        },
      ],
      day_totals: { calories: 1025, protein: 123, carbs: 47, fat: 36, fiber: 15 },
    }],
  };

  // Inject a dummy entry so App.setSetupMode(false) fires and
  // #today-meal-suggestion isn't hidden (new-user welcome state hides it)
  await page.evaluate(async (today) => {
    await DB.addEntry({
      id: 'test_entry_' + Date.now(),
      type: 'meal', subtype: 'lunch', date: today,
      timestamp: new Date(today + 'T12:00:00').toISOString(),
      notes: 'Test lunch', photo: false,
    });
    await DB.setProfile('goals', { calories: 1200, protein: 105, fiber: 25, water_oz: 64 });
  }, today);

  await page.evaluate(async (mp) => { await DB.saveMealPlan(mp); }, mealPlan);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Today tab should be default
  await page.screenshot({ path: path.join(OUT_DIR, '01-today-initial.png'), fullPage: true });

  // Find and tap the Tonight collapsible header. Collapsible lives on the Diet
  // panel of the Today tab, possibly below the fold -- scroll to it first.
  const header = await page.$('#meal-collapse-header');
  if (!header) {
    console.log('FAIL: #meal-collapse-header not found on Today tab');
    await page.screenshot({ path: path.join(OUT_DIR, '99-no-header.png'), fullPage: true });
    await browser.close(); srv.close(); process.exit(1);
  }
  console.log('PASS: Tonight card header found');

  // Diagnose visibility — walk ancestors and find what's hiding the header.
  const diag = await page.evaluate(() => {
    const h = document.getElementById('meal-collapse-header');
    if (!h) return { found: false };
    const chain = [];
    let el = h;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      chain.push({
        tag: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ').slice(0, 3).join('.') : ''),
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
      });
      el = el.parentElement;
    }
    return { found: true, chain };
  });
  console.log('\nVisibility chain for #meal-collapse-header:');
  for (const c of diag.chain || []) {
    console.log(`  ${c.tag}: display=${c.display}, visibility=${c.visibility}, opacity=${c.opacity}, w=${c.width}, h=${c.height}`);
  }

  // Force-click via JS since the headless browser may not render swipeable panels as expected
  await page.evaluate(() => {
    const h = document.getElementById('meal-collapse-header');
    if (h) h.click();
  });
  await page.waitForTimeout(400);
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(OUT_DIR, '02-tonight-expanded.png'), fullPage: true });

  // Scroll into the collapsible body so we can see the ingredients
  await page.evaluate(() => {
    const body = document.getElementById('meal-collapse-body');
    body?.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '02b-tonight-ingredients.png'), fullPage: false });

  // Also bounding-rect check: are the ingredient rows actually visible on-screen?
  const visibility = await page.evaluate(() => {
    const body = document.getElementById('meal-collapse-body');
    if (!body) return { found: false };
    const ingredientBlocks = body.querySelectorAll('div[style*="bg-elevated"]');
    const rects = [];
    ingredientBlocks.forEach(el => {
      const r = el.getBoundingClientRect();
      rects.push({ top: r.top, bottom: r.bottom, width: r.width, height: r.height, visible: r.height > 0 && r.width > 0 });
    });
    return { found: true, count: ingredientBlocks.length, rects };
  });
  console.log('\nIngredient block visibility:', JSON.stringify(visibility, null, 2));

  // Check the DOM actually has the gram rendering
  const hasGrams = await page.evaluate(() => {
    const body = document.getElementById('meal-collapse-body');
    if (!body) return { found: false, reason: 'body missing' };
    const text = body.textContent;
    return {
      found: true,
      hasIngredientText: text.includes('100g') && text.includes('salmon sashimi'),
      has50g: text.includes('50g'),
      has85g: text.includes('85g'),
      has60g: text.includes('60g'),
      hasHalfCup: text.includes('1/2 cup'),
      hasQuarterCup: text.includes('1/4 cup'),
      has1_2tsp: text.includes('1/2 tsp'),
      hasFiberFooter: text.includes('5.5g F') || text.includes('5.5g fiber'),
      snippet: text.slice(0, 400),
    };
  });

  const assertions = [
    ['hasIngredientText (100g salmon)', hasGrams.hasIngredientText],
    ['has 50g                        ', hasGrams.has50g],
    ['has 85g                        ', hasGrams.has85g],
    ['has 60g                        ', hasGrams.has60g],
    ['has 1/2 cup                    ', hasGrams.hasHalfCup],
    ['has 1/4 cup                    ', hasGrams.hasQuarterCup],
    ['has 1/2 tsp (pretty fraction)  ', hasGrams.has1_2tsp],
    ['has fiber in footer            ', hasGrams.hasFiberFooter],
  ];
  console.log('\nDOM assertions:');
  let anyFailed = false;
  for (const [label, ok] of assertions) {
    console.log(`  ${label}:`, ok ? 'PASS' : 'FAIL');
    if (!ok) anyFailed = true;
  }
  console.log('\nText sample:');
  console.log(hasGrams.snippet);

  // Also screenshot at 320px to check narrow viewport
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '03-tonight-320px.png'), fullPage: true });

  await browser.close();
  srv.close();

  console.log(`\nScreenshots saved to ${OUT_DIR}`);
  if (anyFailed) { console.error('\nFAIL: one or more assertions failed'); process.exit(1); }
  console.log('\nPASS: ingredient rendering verified');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
