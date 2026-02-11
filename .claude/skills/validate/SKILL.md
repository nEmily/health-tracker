# /validate — Health Tracker

End-to-end verification that the PWA works correctly.

## Steps

1. **Syntax check**: Run all JS files through Node.js syntax check (`node --check`)
2. **HTML validation**: Check index.html is well-formed (no unclosed tags, all scripts referenced exist)
3. **File integrity**: Verify all files referenced in index.html, manifest.json, and sw.js exist
4. **Serve and test**: Start a local server, fetch the app, verify it returns 200
5. **Service worker**: Verify sw.js is valid and references existing files in its cache list
6. **Console errors**: Load the app in a headless check — verify no import/reference errors

## Commands

```bash
# Syntax check all JS
for f in pwa/scripts/*.js pwa/sw.js; do node --check "$f" 2>&1; done

# Verify all referenced files exist
# Check manifest.json icons exist
# Check sw.js cached files exist

# Serve and test
cd pwa && python -m http.server 8080 &
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080
# Should return 200

# Kill server after test
```

## What to check after each phase

- Phase 1: All routes render, entries save/load from IndexedDB, water slider works
- Phase 2: Camera captures, photos compress to target sizes, photos display
- Phase 3: ZIP export creates valid file, import parses correctly, photo lifecycle tracking
- Phase 4: Processing script runs, valid JSON output, all fields populated
- Phase 5: Calendar renders, streaks calculate, gallery displays photos
