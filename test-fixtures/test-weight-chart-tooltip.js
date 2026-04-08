// test-fixtures/test-weight-chart-tooltip.js
// Verify the weight trend chart tooltip shows the correct value (not 1028)
// Bug: tapping 3/27 data point showed "1028 lbs" when real value was 104.7 lbs

const { chromium } = require('playwright');
const { startServer } = require('./test-server');
const path = require('path');

const PORT = 9041;

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt(d);
}

(async () => {
  const srv = await startServer(path.join(__dirname, '..', 'pwa'), PORT);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.log(`  FAIL: ${name}`); }
  }

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // --- Test 1: Simple 4-day dataset matching Emily's real data ---
  // 3/25=102.7, 3/26=106.6, 3/27=104.7, 3/28=104.5
  // Injected as { weight: { value, unit } } (no weightLog) — post-sync format
  const simpleDays = [
    { date: daysAgo(13), weight: { value: 102.7, unit: 'lbs' } },
    { date: daysAgo(12), weight: { value: 106.6, unit: 'lbs' } },
    { date: daysAgo(11), weight: { value: 104.7, unit: 'lbs' } },
    { date: daysAgo(10), weight: { value: 104.5, unit: 'lbs' } },
    { date: daysAgo(9),  weight: { value: 104.2, unit: 'lbs' } },
    { date: daysAgo(8),  weight: { value: 103.9, unit: 'lbs' } },
    { date: daysAgo(7),  weight: { value: 103.8, unit: 'lbs' } },
    { date: daysAgo(6),  weight: { value: 104.1, unit: 'lbs' } },
    { date: daysAgo(5),  weight: { value: 103.7, unit: 'lbs' } },
    { date: daysAgo(4),  weight: { value: 103.5, unit: 'lbs' } },
    { date: daysAgo(3),  weight: { value: 103.3, unit: 'lbs' } },
    { date: daysAgo(2),  weight: { value: 103.1, unit: 'lbs' } },
    { date: daysAgo(1),  weight: { value: 102.9, unit: 'lbs' } },
    { date: daysAgo(0),  weight: { value: 102.8, unit: 'lbs' } },
  ];

  await page.evaluate(async (days) => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    for (const d of days) {
      await DB.updateDailySummary(d.date, { date: d.date, weight: d.weight });
    }
  }, simpleDays);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Navigate to Progress > Trends
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn = await page.$('button:has-text("Trends")');
  if (trendsBtn) await trendsBtn.click();
  await page.waitForTimeout(800);

  // Inspect dataset.points
  const chartData = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    try {
      const raw = svg.dataset.points;
      const parsed = JSON.parse(raw);
      return { raw: raw.slice(0, 200), parsed };
    } catch(e) {
      return { error: e.message, raw: svg.dataset.points ? svg.dataset.points.slice(0, 200) : null };
    }
  });

  console.log('\n--- Test 1: Simple dataset (post-sync format) ---');
  console.log('dataset.points (first 200 chars):', chartData?.raw);

  if (chartData?.parsed) {
    const weights = chartData.parsed.map(p => p.weight);
    console.log('All parsed weights:', weights);

    // Check for any value > 200 (clear bug indicator)
    const hasCorruptValue = weights.some(w => typeof w !== 'number' || w > 200 || w < 50);
    assert(!hasCorruptValue, `All weight values are reasonable numbers (50-200 range): ${JSON.stringify(weights)}`);

    // Specifically check the 3/27 analog (index 2 in our 14-day set, which is daysAgo(11))
    // Find the day with weight 104.7
    const day1047 = chartData.parsed.find(p => Math.abs(p.weight - 104.7) < 0.01);
    assert(day1047 !== undefined, `104.7 lbs entry exists in chart data`);
    if (day1047) {
      assert(day1047.weight === 104.7, `104.7 entry has correct weight value (got: ${day1047.weight})`);
    }
  } else {
    console.log('ERROR reading chart data:', chartData?.error);
  }

  // --- Test 2: Multi-weightLog day (the high-risk scenario) ---
  // Emily's phone may have two weight entries on the same day via weightLog
  console.log('\n--- Test 2: Multi-weightLog day ---');

  const ts = (daysBack, h) => new Date(`${daysAgo(daysBack)}T${String(h).padStart(2,'0')}:00:00`).getTime();

  const multiWeightDays = [
    { date: daysAgo(5), weight: { value: 102.7, unit: 'lbs', timestamp: ts(5, 7) } },
    {
      date: daysAgo(4),
      weight: { value: 102.8, unit: 'lbs', timestamp: ts(4, 7) }, // first of day (used by renderWeightTrend)
      weightLog: [
        { value: 102.8, unit: 'lbs', timestamp: ts(4, 7) },
        { value: 104.7, unit: 'lbs', timestamp: ts(4, 18) },
      ]
    },
    { date: daysAgo(3), weight: { value: 103.1, unit: 'lbs', timestamp: ts(3, 7) } },
    { date: daysAgo(2), weight: { value: 103.3, unit: 'lbs', timestamp: ts(2, 7) } },
    { date: daysAgo(1), weight: { value: 103.5, unit: 'lbs', timestamp: ts(1, 7) } },
    { date: daysAgo(0), weight: { value: 103.7, unit: 'lbs', timestamp: ts(0, 7) } },
  ];

  await page.evaluate(async (days) => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    for (const d of days) {
      await DB.updateDailySummary(d.date, d);
    }
  }, multiWeightDays);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn2 = await page.$('button:has-text("Trends")');
  if (trendsBtn2) await trendsBtn2.click();
  await page.waitForTimeout(800);

  const multiChartData = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    try {
      const parsed = JSON.parse(svg.dataset.points);
      return { parsed };
    } catch(e) {
      return { error: e.message };
    }
  });

  if (multiChartData?.parsed) {
    const weights = multiChartData.parsed.map(p => p.weight);
    console.log('Multi-weightLog chart weights:', weights);
    const hasCorrupt = weights.some(w => typeof w !== 'number' || w > 200 || w < 50);
    assert(!hasCorrupt, `Multi-weightLog: all weights are reasonable (50-200): ${JSON.stringify(weights)}`);

    // The multi-weight day should show the FIRST measurement (102.8), not the second (104.7)
    // and definitely not a corrupted value
    const multiDay = multiChartData.parsed.find((p, i) => i === 1); // second entry = daysAgo(4)
    if (multiDay) {
      assert(multiDay.weight === 102.8, `Multi-weightLog day shows first measurement 102.8 (got: ${multiDay.weight})`);
    }
  }

  // --- Test 3: Simulate the tooltip via programmatic point inspection ---
  // We can't easily send touch events in headless Playwright, but we can
  // directly verify what tooltip.textContent would show for each point
  console.log('\n--- Test 3: Tooltip value verification via direct JS ---');

  // Restore simple dataset
  await page.evaluate(async (days) => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    for (const d of days) {
      await DB.updateDailySummary(d.date, { date: d.date, weight: d.weight });
    }
  }, simpleDays);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn3 = await page.$('button:has-text("Trends")');
  if (trendsBtn3) await trendsBtn3.click();
  await page.waitForTimeout(800);

  // Simulate what the tooltip shows for each point by calling the internal logic
  const tooltipValues = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    const points = JSON.parse(svg.dataset.points || '[]');
    // Simulate what tooltip.textContent = `${pt.weight} lbs · ${dateLabel}` produces
    return points.map(pt => {
      const dateLabel = new Date(pt.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${pt.weight} lbs · ${dateLabel}`;
    });
  });

  console.log('Simulated tooltip values:');
  tooltipValues?.forEach(v => console.log(' ', v));

  // None should contain values over 200
  const corruptTooltips = tooltipValues?.filter(v => {
    const match = v.match(/^([0-9.]+) lbs/);
    return match && parseFloat(match[1]) > 200;
  });
  assert(!corruptTooltips || corruptTooltips.length === 0,
    `No tooltip shows weight > 200 lbs (corrupt: ${JSON.stringify(corruptTooltips)})`);

  // Specifically the 104.7 entry should show "104.7 lbs"
  const entry1047 = tooltipValues?.find(v => v.startsWith('104.7'));
  assert(entry1047 !== undefined, `Tooltip for 104.7 lbs entry shows "104.7 lbs ·..." (found: ${entry1047})`);

  // --- Test 4: weightLog with ISO string timestamps (potential sort corruption) ---
  console.log('\n--- Test 4: weightLog with ISO string timestamps ---');

  const isoStringTimestampDays = [
    { date: daysAgo(5), weight: { value: 102.0, unit: 'lbs' } },
    {
      date: daysAgo(4),
      // timestamp stored as ISO string (bad format, but defensive check)
      weightLog: [
        { value: 104.7, unit: 'lbs', timestamp: `${daysAgo(4)}T07:00:00.000Z` },
        { value: 106.6, unit: 'lbs', timestamp: `${daysAgo(4)}T18:00:00.000Z` },
      ]
    },
    { date: daysAgo(3), weight: { value: 103.0, unit: 'lbs' } },
    { date: daysAgo(2), weight: { value: 103.2, unit: 'lbs' } },
    { date: daysAgo(1), weight: { value: 103.4, unit: 'lbs' } },
    { date: daysAgo(0), weight: { value: 103.6, unit: 'lbs' } },
  ];

  await page.evaluate(async (days) => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    for (const d of days) {
      await DB.updateDailySummary(d.date, d);
    }
  }, isoStringTimestampDays);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn4 = await page.$('button:has-text("Trends")');
  if (trendsBtn4) await trendsBtn4.click();
  await page.waitForTimeout(800);

  const isoChartData = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    try {
      const parsed = JSON.parse(svg.dataset.points);
      return { parsed };
    } catch(e) {
      return { error: e.message };
    }
  });

  if (isoChartData?.parsed) {
    const weights = isoChartData.parsed.map(p => p.weight);
    console.log('ISO-string-timestamp chart weights:', weights);
    const hasCorrupt = weights.some(w => w === undefined || w === null || (typeof w === 'number' && w > 200));
    assert(!hasCorrupt, `ISO-timestamp weightLog: no corrupt values: ${JSON.stringify(weights)}`);
  }

  // --- Test 5: importAnalysis with corrected weight writes back to dailySummary ---
  // This is the root cause test: user entered 1028 (missing decimal, meant 102.8).
  // Processing corrects it in analysis JSON. importAnalysis must write the correction
  // back to dailySummary so the chart shows 102.8 not 1028.
  console.log('\n--- Test 5: importAnalysis corrected weight write-back ---');

  const corruptDate = daysAgo(3);
  // Simulate what was stored from the phone: user typed 1028 instead of 102.8
  await page.evaluate(async (d) => {
    await DB.updateDailySummary(d, { date: d, weight: { value: 1028, unit: 'lbs', timestamp: Date.now() } });
  }, corruptDate);

  // Confirm the bad value is in the summary before fix
  const beforeFix = await page.evaluate(async (d) => {
    const s = await DB.getDailySummary(d);
    return s.weight?.value;
  }, corruptDate);
  console.log('  Before fix, dailySummary.weight.value:', beforeFix);
  assert(beforeFix === 1028, `Bad value 1028 was stored in dailySummary (got: ${beforeFix})`);

  // Now simulate importAnalysis with a corrected weight (what processing would output)
  await page.evaluate(async (d) => {
    await DB.importAnalysis(d, {
      date: d,
      entries: [],
      totals: { calories: 1200, protein: 100, carbs: 100, fat: 40 },
      weight: {
        value: 102.8,
        unit: 'lbs',
        raw_value: 1028,
        corrected: true,
        correction_note: 'Auto-corrected from 1028 -- missing decimal, 10x expected range'
      }
    });
  }, corruptDate);

  // Verify dailySummary now has the corrected value
  const afterFix = await page.evaluate(async (d) => {
    const s = await DB.getDailySummary(d);
    return s.weight?.value;
  }, corruptDate);
  console.log('  After importAnalysis, dailySummary.weight.value:', afterFix);
  assert(afterFix === 102.8, `importAnalysis corrects dailySummary to 102.8 (got: ${afterFix})`);

  // Now render the chart and verify 102.8 appears, not 1028
  // Set up context: add more weight days so chart renders
  const surroundDays = [
    { date: daysAgo(6), weight: { value: 103.0, unit: 'lbs' } },
    { date: daysAgo(5), weight: { value: 102.9, unit: 'lbs' } },
    { date: daysAgo(4), weight: { value: 102.7, unit: 'lbs' } },
    // daysAgo(3) = corruptDate now has 102.8 after fix
    { date: daysAgo(2), weight: { value: 103.1, unit: 'lbs' } },
    { date: daysAgo(1), weight: { value: 103.3, unit: 'lbs' } },
    { date: daysAgo(0), weight: { value: 103.5, unit: 'lbs' } },
  ];
  await page.evaluate(async (days) => {
    for (const d of days) {
      await DB.updateDailySummary(d.date, { date: d.date, weight: d.weight });
    }
  }, surroundDays);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn5 = await page.$('button:has-text("Trends")');
  if (trendsBtn5) await trendsBtn5.click();
  await page.waitForTimeout(800);

  const chartAfterFix = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    try {
      return JSON.parse(svg.dataset.points);
    } catch(e) { return null; }
  });

  if (chartAfterFix) {
    const weights = chartAfterFix.map(p => p.weight);
    console.log('  Chart weights after correction:', weights);
    const has1028 = weights.some(w => w === 1028 || w > 200);
    assert(!has1028, `Chart does not show 1028 after correction (weights: ${JSON.stringify(weights)})`);
    const has1028fixed = weights.some(w => Math.abs(w - 102.8) < 0.01);
    assert(has1028fixed, `Chart shows corrected 102.8 value (weights: ${JSON.stringify(weights)})`);
  } else {
    console.log('  Chart not found after fix test');
  }

  // Simulate tooltip for all points — none should show > 200
  const tooltipCheck = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return [];
    const points = JSON.parse(svg.dataset.points || '[]');
    return points.map(pt => {
      const dateLabel = new Date(pt.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${pt.weight} lbs · ${dateLabel}`;
    });
  });
  const badTooltip = tooltipCheck.find(v => {
    const m = v.match(/^([0-9.]+) lbs/);
    return m && parseFloat(m[1]) > 200;
  });
  assert(!badTooltip, `No tooltip shows corrupt value > 200 lbs (found: ${badTooltip})`);

  await browser.close();
  srv.close();

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
