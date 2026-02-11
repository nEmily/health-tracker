# Health Tracker

Personal AI-powered health tracking PWA. Capture food photos, workouts, water, weight, sleep, and body progress on iPhone. Sync to Windows PC via iCloud Drive. Claude Code processes nightly — analyzing food photos, estimating calories/macros, tracking goals, generating meal plans and workout recommendations.

## Tech Stack

- **PWA**: Vanilla HTML/CSS/JS, no build step, no framework
- **Storage**: IndexedDB for phone-side data
- **Sync**: ZIP export via `navigator.share()` → iCloud Drive
- **Processing**: Claude Code CLI nightly via Task Scheduler
- **Hosting**: GitHub Pages
- **Data**: JSON + JPEG + Markdown

## Project Structure

- `pwa/` — the PWA served via GitHub Pages
  - `index.html` — single-page app shell
  - `manifest.json` — PWA manifest
  - `sw.js` — service worker for offline
  - `styles/` — CSS (theme.css, main.css, components.css)
  - `scripts/` — JS modules (app.js, db.js, log.js, camera.js, sync.js, calendar.js, goals.js, ui.js)
  - `assets/icons/` — PWA icons
- `processing/` — nightly Claude processing scripts
- `docs/` — setup guides

## iCloud Data Location

`C:\Users\emily\iCloudDrive\HealthTracker\` (NEVER in git)

## Key Principles

1. Meal photos are temporary (delete after analysis), body photos are permanent
2. Data layer is the stable contract — views are disposable
3. No build step, no framework, vanilla everything
4. All data stays private and local

## Running Locally

```bash
cd pwa && python -m http.server 8080
```

Then open http://localhost:8080

## Validation

Run `/validate` after any code changes. It checks:
- HTML/JS syntax validity
- Service worker registration
- All script files load without errors
- App renders and routes work
