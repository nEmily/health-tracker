# PWA Setup on iPhone

## 1. Deploy to GitHub Pages

Push the repo to GitHub, then enable Pages:

1. Go to repo Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)**
4. Save

Your app will be at: `https://<username>.github.io/health-tracker/pwa/`

## 2. Install on iPhone

1. Open Safari on your iPhone
2. Navigate to your GitHub Pages URL
3. Tap the **Share** button (square with arrow)
4. Scroll down and tap **Add to Home Screen**
5. Name it "Health" (or whatever you like)
6. Tap **Add**

The app icon (green heart) appears on your home screen. It launches in standalone mode (no browser chrome).

## 3. Daily usage

### Logging
- Open the app → tap **Log** (+ icon)
- Pick the type (Meal, Snack, Drink, Workout, Water, Weight, Body Photo)
- Take a photo and/or add notes → Save

### End of day sync
1. Tap **Settings** (gear icon)
2. Tap **Export Today's Data**
3. In the share sheet, tap **Save to Files**
4. Navigate to iCloud Drive → HealthTracker
5. Save

### After Claude processes (next morning)
1. Tap **Settings** → **Import Analysis**
2. Navigate to iCloud Drive → HealthTracker → analysis → today's date
3. Select `summary.json`
4. Your analysis appears in the app

### Photo cleanup
- Settings → **Clear Processed Meal Photos** removes meal photos that Claude has already analyzed
- Body progress photos are never deleted
