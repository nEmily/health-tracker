// db.js — IndexedDB wrapper (view-agnostic data API)

const DB_NAME = 'health-tracker';
const DB_VERSION = 4;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Entries: meals, snacks, drinks, workouts
      if (!db.objectStoreNames.contains('entries')) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date', { unique: false });
        entries.createIndex('type', 'type', { unique: false });
        entries.createIndex('date_type', ['date', 'type'], { unique: false });
      }

      // Photos: linked to entries or body progress
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('entryId', 'entryId', { unique: false });
        photos.createIndex('date', 'date', { unique: false });
        photos.createIndex('category', 'category', { unique: false }); // 'meal' | 'body'
        photos.createIndex('syncStatus', 'syncStatus', { unique: false }); // 'unsynced' | 'synced' | 'processed'
      }

      // Daily summaries: water, weight, sleep, notes
      if (!db.objectStoreNames.contains('dailySummary')) {
        db.createObjectStore('dailySummary', { keyPath: 'date' });
      }

      // Analysis: Claude's output per day
      if (!db.objectStoreNames.contains('analysis')) {
        db.createObjectStore('analysis', { keyPath: 'date' });
      }

      // Profile: goals, regimen, preferences
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'key' });
      }

      // Meal plans
      if (!db.objectStoreNames.contains('mealPlan')) {
        db.createObjectStore('mealPlan', { keyPath: 'generatedDate' });
      }

      // Analysis history (v2) — archives old analysis before overwrite
      if (e.oldVersion < 2) {
        if (!db.objectStoreNames.contains('analysisHistory')) {
          const historyStore = db.createObjectStore('analysisHistory', { keyPath: 'id', autoIncrement: true });
          historyStore.createIndex('date', 'date', { unique: false });
          historyStore.createIndex('importedAt', 'importedAt', { unique: false });
        }
      }

      // Challenges (v4)
      if (e.oldVersion < 4) {
        if (!db.objectStoreNames.contains('challenges')) {
          const chalStore = db.createObjectStore('challenges', { keyPath: 'id' });
          chalStore.createIndex('status', 'status', { unique: false });
          chalStore.createIndex('startDate', 'startDate', { unique: false });
        }
        if (!db.objectStoreNames.contains('challengeProgress')) {
          const progStore = db.createObjectStore('challengeProgress', { keyPath: 'id' });
          progStore.createIndex('challengeId', 'challengeId', { unique: false });
          progStore.createIndex('date', 'date', { unique: false });
        }
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// --- Entries ---

async function addEntry(entry, photoBlobs) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'photos'], 'readwrite');

  tx.objectStore('entries').put(entry);

  if (photoBlobs) {
    // Support both single blob (legacy) and array of blobs
    const blobs = Array.isArray(photoBlobs) ? photoBlobs : [photoBlobs];
    const category = entry.type === 'bodyPhoto' ? 'body' : 'meal';
    for (let i = 0; i < blobs.length; i++) {
      const photoRecord = {
        id: i === 0 ? `photo_${entry.id}` : `photo_${entry.id}_${i + 1}`,
        entryId: entry.id,
        date: entry.date,
        category,
        syncStatus: 'unsynced',
        blob: blobs[i],
        timestamp: entry.timestamp,
      };
      tx.objectStore('photos').put(photoRecord);
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(entry);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getEntriesByDate(dateStr) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const index = tx.objectStore('entries').index('date');
  const request = index.getAll(dateStr);
  const results = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });

  // Fallback: full scan if date index returns empty (iOS IDB index corruption workaround)
  if (results.length === 0) {
    const allReq = db.transaction('entries', 'readonly').objectStore('entries').getAll();
    const all = await new Promise((resolve, reject) => {
      allReq.onsuccess = () => resolve(allReq.result);
      allReq.onerror = () => resolve([]);
    });
    const filtered = all.filter(e => e.date === dateStr);
    if (filtered.length > 0) {
      console.warn(`getEntriesByDate: index missed ${filtered.length} entries for ${dateStr}, using full scan`);
    }
    return filtered;
  }
  return results;
}

async function getEntriesByDateRange(startDate, endDate) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const index = tx.objectStore('entries').index('date');
  const range = IDBKeyRange.bound(startDate, endDate);
  const request = index.getAll(range);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getEntriesByType(type, startDate, endDate) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const store = tx.objectStore('entries');

  if (startDate && endDate) {
    const index = store.index('date_type');
    const results = [];
    const range = IDBKeyRange.bound([startDate, type], [endDate, type]);
    const request = index.openCursor(range);
    return new Promise((resolve, reject) => {
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          // Compound key range includes entries between [startDate,type] and [endDate,type]
          // which can match other types lexicographically between the bounds — filter to exact type
          if (cursor.value.type === type) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  const index = store.index('type');
  const request = index.getAll(type);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getAllEntries() {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const request = tx.objectStore('entries').getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function hasAnyEntries() {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const request = tx.objectStore('entries').openCursor();
  return new Promise((resolve) => {
    request.onsuccess = (e) => resolve(!!e.target.result);
    request.onerror = () => resolve(false);
  });
}

async function updateEntry(entry) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  tx.objectStore('entries').put(entry);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(entry);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function updatePhotoDate(photoId, newDate) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const req = store.get(photoId);
    req.onsuccess = () => {
      const photo = req.result;
      if (photo && photo.date !== newDate) {
        store.put({ ...photo, date: newDate });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Add photos to an existing entry (for "Add Photo" in edit modal)
async function addPhotosToEntry(entryId, photoBlobs, entry) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'photos'], 'readwrite');

  // Get existing photo count to generate unique IDs
  const photoIndex = tx.objectStore('photos').index('entryId');
  const existingPhotos = await new Promise((resolve, reject) => {
    const req = photoIndex.getAll(entryId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });

  const blobs = Array.isArray(photoBlobs) ? photoBlobs : [photoBlobs];
  const category = entry && entry.type === 'bodyPhoto' ? 'body' : 'meal';
  const startIdx = existingPhotos.length;

  for (let i = 0; i < blobs.length; i++) {
    const photoRecord = {
      id: `photo_${entryId}_${startIdx + i + 1}`,
      entryId,
      date: entry ? entry.date : existingPhotos[0]?.date,
      category,
      syncStatus: 'unsynced',
      blob: blobs[i],
      timestamp: new Date().toISOString(),
    };
    tx.objectStore('photos').put(photoRecord);
  }

  // Update entry.photo = true if not already
  if (entry && !entry.photo) {
    const updated = { ...entry, photo: true, updatedAt: new Date().toISOString() };
    tx.objectStore('entries').put(updated);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(startIdx + blobs.length);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function deleteEntry(id) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'photos'], 'readwrite');
  tx.objectStore('entries').delete(id);
  // Also delete associated photo
  const photoStore = tx.objectStore('photos');
  const photoIndex = photoStore.index('entryId');
  const request = photoIndex.openCursor(id);
  request.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Daily Summary (water, weight, sleep, notes) ---

async function getDailySummary(dateStr) {
  const db = await openDB();
  const tx = db.transaction('dailySummary', 'readonly');
  const request = tx.objectStore('dailySummary').get(dateStr);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || { date: dateStr });
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getAllDailySummaries() {
  const db = await openDB();
  const tx = db.transaction('dailySummary', 'readonly');
  const request = tx.objectStore('dailySummary').getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getDailySummaryRange(startDate, endDate) {
  const db = await openDB();
  const tx = db.transaction('dailySummary', 'readonly');
  const range = IDBKeyRange.bound(startDate, endDate);
  const request = tx.objectStore('dailySummary').getAll(range);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function updateDailySummary(dateStr, updates) {
  const db = await openDB();
  const existing = await getDailySummary(dateStr);
  const merged = { ...existing, ...updates, date: dateStr };
  const tx = db.transaction('dailySummary', 'readwrite');
  tx.objectStore('dailySummary').put(merged);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(merged);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Photos ---

async function getPhotos(entryId) {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  const index = tx.objectStore('photos').index('entryId');
  const request = index.getAll(entryId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getBodyPhotos(dateStr) {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  const index = tx.objectStore('photos').index('date');
  const request = index.getAll(dateStr);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const all = request.result;
      resolve(all.filter(p => p.category === 'body'));
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getPhotoSyncStatus() {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  const store = tx.objectStore('photos');
  // Use cursor to count without loading all blobs into memory
  const request = store.openCursor();
  const counts = { unsynced: 0, synced: 0, processed: 0, totalSize: 0 };
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const p = cursor.value;
        counts[p.syncStatus] = (counts[p.syncStatus] || 0) + 1;
        if (p.blob) counts.totalSize += p.blob.size || 0;
        cursor.continue();
      } else {
        resolve(counts);
      }
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function clearProcessedPhotos() {
  const db = await openDB();
  const tx = db.transaction('photos', 'readwrite');
  const index = tx.objectStore('photos').index('syncStatus');
  const request = index.openCursor('processed');
  let count = 0;
  return new Promise((resolve, reject) => {
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.category !== 'body') {
          cursor.delete();
          count++;
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Analysis ---

async function getAnalysis(dateStr) {
  const db = await openDB();
  const tx = db.transaction('analysis', 'readonly');
  const request = tx.objectStore('analysis').get(dateStr);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function importAnalysis(dateStr, data) {
  const db = await openDB();

  // Pre-read local supplements, moreOptions, deletedDailies, and existing dailySummary before
  // the write transaction to avoid IDB transaction auto-commit timing issues with async get→put chains.
  let localSupplements = [];
  let localMoreOptions = [];
  let deletedDailiesSet = new Set();
  let existingDailySummary = null;
  if (data.pwaProfile) {
    const readTx = db.transaction('profile', 'readonly');
    const readStore = readTx.objectStore('profile');
    const [suppResult, moreResult, deletedResult] = await Promise.all([
      new Promise(r => { const req = readStore.get('supplements'); req.onsuccess = () => r(req.result?.value || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = readStore.get('moreOptions'); req.onsuccess = () => r(req.result?.value || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = readStore.get('deletedDailies'); req.onsuccess = () => r(req.result?.value || []); req.onerror = () => r([]); }),
    ]);
    localSupplements = suppResult;
    localMoreOptions = moreResult;
    deletedDailiesSet = new Set(deletedResult);
  }
  // Pre-read dailySummary for dateStr if weight correction may be needed — avoids get→put
  // race with transaction auto-commit (TransactionInactiveError).
  if (data.weight && data.weight.corrected && typeof data.weight.value === 'number') {
    const dsReadTx = db.transaction('dailySummary', 'readonly');
    existingDailySummary = await new Promise(r => {
      const req = dsReadTx.objectStore('dailySummary').get(dateStr);
      req.onsuccess = () => r(req.result || null);
      req.onerror = () => r(null);
    });
  }

  const stores = ['analysis', 'photos', 'dailySummary'];
  if (db.objectStoreNames.contains('analysisHistory')) stores.push('analysisHistory');
  if (data.mealPlan) stores.push('mealPlan');
  if (data.regimen || data.pwaProfile || data.supplementUpdates || data.settingUpdates) stores.push('profile');
  const tx = db.transaction(stores, 'readwrite');

  // Extract and save bundled meal plan and regimen before storing analysis
  if (data.mealPlan) {
    const plan = { ...data.mealPlan };
    // Normalize generatedDate to a string. Older synthesis output emitted
    // `generated: <epoch ms>` (number); the keyPath/sort logic expects strings.
    if (!plan.generatedDate) {
      const raw = plan.generated || dateStr;
      plan.generatedDate = (typeof raw === 'number')
        ? new Date(raw).toISOString().slice(0, 10)
        : String(raw);
    } else if (typeof plan.generatedDate === 'number') {
      plan.generatedDate = new Date(plan.generatedDate).toISOString().slice(0, 10);
    }
    tx.objectStore('mealPlan').put(plan);
  }
  if (data.regimen) {
    tx.objectStore('profile').put({ key: 'regimen', value: data.regimen });
  }

  // Restore PWA profile (goals + dailies) — survives reinstalls/cache clears
  if (data.pwaProfile) {
    const profileStore = tx.objectStore('profile');
    if (data.pwaProfile.goals) {
      const _goalsVal = (typeof Goals !== 'undefined' && Goals.resolve)
        ? Goals.resolve(data.pwaProfile.goals)
        : data.pwaProfile.goals;
      profileStore.put({ key: 'goals', value: _goalsVal });
    }
    if (data.pwaProfile.supplements && !data.supplementUpdates) {
      // Merge echo-back supplements with local — don't overwrite items added since last upload,
      // and never re-add items the user explicitly deleted (tracked in deletedDailies).
      const remote = data.pwaProfile.supplements;
      if (localSupplements.length === 0 && deletedDailiesSet.size === 0) {
        profileStore.put({ key: 'supplements', value: remote });
      } else {
        const localKeys = new Set(localSupplements.map(s => s.key));
        const merged = [...localSupplements];
        for (const item of remote) {
          if (!localKeys.has(item.key) && !deletedDailiesSet.has(item.key)) merged.push(item);
        }
        profileStore.put({ key: 'supplements', value: merged });
      }
    }
    if (data.pwaProfile.bodyPhotoTypes) {
      profileStore.put({ key: 'bodyPhotoTypes', value: data.pwaProfile.bodyPhotoTypes });
    }
    if (data.pwaProfile.moreOptions) {
      // Merge echo-back moreOptions with local — don't overwrite items added since last upload
      const remote = data.pwaProfile.moreOptions;
      if (localMoreOptions.length === 0) {
        profileStore.put({ key: 'moreOptions', value: remote });
      } else {
        const localKeys = new Set(localMoreOptions.map(o => o.type || o.key));
        const merged = [...localMoreOptions];
        for (const item of remote) {
          if (!localKeys.has(item.type || item.key)) merged.push(item);
        }
        profileStore.put({ key: 'moreOptions', value: merged });
      }
    }
    if (data.pwaProfile.preferences) {
      profileStore.put({ key: 'preferences', value: data.pwaProfile.preferences });
    }
  }

  // Merge supplement updates from AI processing (photo → nutrition extraction)
  if (data.supplementUpdates && Array.isArray(data.supplementUpdates)) {
    const profileStore2 = stores.includes('profile') ? tx.objectStore('profile') : null;
    if (profileStore2) {
      const suppReq = profileStore2.get('supplements');
      suppReq.onsuccess = () => {
        const existing = suppReq.result?.value || [];
        for (const update of data.supplementUpdates) {
          // Match by key first, fall back to matching any pending item
          // (processing may output a product-name-based key instead of the original)
          let match = existing.find(s => s.key === update.key);
          if (!match) {
            match = existing.find(s => s.pending);
          }
          if (match) {
            if (update.name) {
              match.name = update.name;
              // Update key to match the new name so future updates align
              match.key = update.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 50);
            }
            if (update.calories != null) match.calories = update.calories;
            if (update.protein != null) match.protein = update.protein;
            if (update.carbs != null) match.carbs = update.carbs;
            if (update.fat != null) match.fat = update.fat;
            match.pending = false;
            delete match.photo; // Photo served its purpose — free the space
          }
        }
        profileStore2.put({ key: 'supplements', value: existing });
      };
    }
  }

  // Apply coach setting updates (goals, preferences changes requested via chat)
  if (data.settingUpdates && typeof data.settingUpdates === 'object') {
    const profileStore3 = tx.objectStore('profile');

    if (data.settingUpdates.goals) {
      const goalsReq = profileStore3.get('goals');
      goalsReq.onsuccess = () => {
        const existing = goalsReq.result?.value || {};
        const updates = data.settingUpdates.goals;
        // Shallow merge top-level, deep merge 'hardcore' sub-object
        for (const [k, v] of Object.entries(updates)) {
          if (k === 'hardcore' && typeof v === 'object') {
            existing.hardcore = { ...(existing.hardcore || {}), ...v };
          } else {
            existing[k] = v;
          }
        }
        profileStore3.put({ key: 'goals', value: existing });
      };
    }

    if (data.settingUpdates.preferences) {
      const prefsReq = profileStore3.get('preferences');
      prefsReq.onsuccess = () => {
        const existing = prefsReq.result?.value || {};
        Object.assign(existing, data.settingUpdates.preferences);
        profileStore3.put({ key: 'preferences', value: existing });
      };
    }
  }

  // Archive existing analysis before overwriting (v2+), cap at 5 per date
  if (db.objectStoreNames.contains('analysisHistory')) {
    const histStore = tx.objectStore('analysisHistory');
    const existingReq = tx.objectStore('analysis').get(dateStr);
    existingReq.onsuccess = () => {
      try {
        const existing = existingReq.result;
        if (existing) {
          histStore.add({
            date: existing.date,
            importedAt: existing.importedAt || 0,
            data: existing,
          });
          // Cap history to 5 entries per date — delete oldest
          const idx = histStore.index('date');
          const countReq = idx.getAll(dateStr);
          countReq.onsuccess = () => {
            const all = countReq.result;
            if (all.length > 5) {
              all.sort((a, b) => (a.importedAt || 0) - (b.importedAt || 0));
              for (let i = 0; i < all.length - 5; i++) {
                histStore.delete(all[i].id);
              }
            }
          };
        }
      } catch (e) {
        console.warn('Failed to archive analysis history:', e);
      }
    };
  }

  // Store analysis without the bundled plan/regimen/profile (keep it lean)
  const { mealPlan, regimen, pwaProfile, ...analysisData } = data;
  tx.objectStore('analysis').put({ ...analysisData, date: dateStr, importedAt: Date.now() });

  // Write corrected weight back to dailySummary so the chart reflects the correction.
  // The processing script may auto-correct impossible values (e.g. 1028 -> 102.8 for a missing
  // decimal point). Without this, dailySummary.weight.value stays at the raw bad value and
  // the weight trend chart shows the corrupted number even after the analysis correction syncs back.
  // existingDailySummary was pre-read before this transaction to avoid TransactionInactiveError.
  if (data.weight && data.weight.corrected && typeof data.weight.value === 'number') {
    const summaryStore = tx.objectStore('dailySummary');
    const existing = existingDailySummary || { date: dateStr };
    const updated = {
      ...existing,
      date: dateStr,
      weight: {
        ...(existing.weight || {}),
        value: data.weight.value,
        unit: data.weight.unit || (existing.weight && existing.weight.unit) || 'lbs',
        corrected: true,
      },
    };
    // Also patch weightLog entries if present — keep them consistent
    if (Array.isArray(updated.weightLog) && updated.weightLog.length > 0) {
      const sorted = updated.weightLog.slice().sort((a, b) => {
        const ta = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
        const tb = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
        return ta - tb;
      });
      // Only patch the first (earliest) entry — that's the one renderWeightTrend uses
      if (typeof sorted[0].value === 'number' && sorted[0].value > 200) {
        sorted[0].value = data.weight.value;
        updated.weightLog = sorted;
      }
    }
    summaryStore.put(updated);
  }

  // Mark meal photos for this date as processed
  const photoIndex = tx.objectStore('photos').index('date');
  const request = photoIndex.openCursor(dateStr);
  request.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      if (cursor.value.category === 'meal') {
        const updated = { ...cursor.value, syncStatus: 'processed' };
        cursor.update(updated);
      }
      cursor.continue();
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getAnalysisRange(startDate, endDate) {
  const db = await openDB();
  const tx = db.transaction('analysis', 'readonly');
  const store = tx.objectStore('analysis');
  const range = IDBKeyRange.bound(startDate, endDate);
  const request = store.getAll(range);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// --- Profile ---
//
// Profile key ownership — who is the canonical writer for each key:
//
//   PHONE-authored (phone creates/updates directly):
//     supplements        — user-managed list; includes a `pending` flag for unsynced items
//     bodyPhotoTypes     — which body areas the user has opted in to photograph
//     moreOptions        — UI feature toggles
//     deletedDailies     — tombstones for deleted daily-summary entries
//     period             — menstrual cycle tracking state
//     cloudRelay         — sync endpoint + key config
//     pendingGoalUpdates — delta queue; phone writes, cron drains and clears
//     skincare           — skincare log entries
//     coachContext       — free-text note the user attaches to the current day
//
//   CRON-authored (cron writes canonical copy; phone reads only):
//     goals              — canonical goal targets; cron echoes back via pwaProfile
//     regimen            — workout schedule generated by cron
//     preferences        — coaching tone, staples, dietary rules
//     identity           — user bio (name, age, height, etc.)
//
//   NOTE: `goals` is a dual-writer key — phone does an OPTIMISTIC write first
//   (so the UI feels snappy), then queues a delta in `pendingGoalUpdates`.
//   Cron applies the delta and echoes the canonical shape back on next analysis.
//   Always call DB.queueGoalUpdate() after any phone-side goals write so cron
//   stays in sync. Use setProfileOwned() to catch accidental direct phone writes.

async function getProfile(key) {
  const db = await openDB();
  const tx = db.transaction('profile', 'readonly');
  const request = tx.objectStore('profile').get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ? request.result.value : null);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function setProfile(key, value) {
  const db = await openDB();
  const tx = db.transaction('profile', 'readwrite');
  tx.objectStore('profile').put({ key, value });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Write a profile key and warn if the caller isn't the declared owner.
// Pass expectedOwner='cron-via-delta' for phone-side optimistic goals writes
// that are accompanied by a DB.queueGoalUpdate() call.
async function setProfileOwned(key, value, expectedOwner) {
  const OWNERSHIP = {
    supplements: 'phone', bodyPhotoTypes: 'phone', moreOptions: 'phone',
    deletedDailies: 'phone', period: 'phone', cloudRelay: 'phone',
    pendingGoalUpdates: 'phone', skincare: 'phone', coachContext: 'phone',
    goals: 'cron-via-delta', regimen: 'cron', preferences: 'cron', identity: 'cron',
  };
  const declared = OWNERSHIP[key];
  if (declared && expectedOwner !== declared) {
    console.warn(`setProfileOwned: '${key}' is owned by '${declared}' but written by '${expectedOwner}'. Use queueGoalUpdate() for goals deltas.`);
  }
  return setProfile(key, value);
}

// --- Goal-update delta queue ---
//
// The phone is no longer the canonical writer for goals (see sync.js architecture
// comment). When the user changes goals via Settings, the phone:
//   1. Updates IndexedDB.goals optimistically so the UI reflects the change immediately.
//   2. Appends a delta entry to IndexedDB.pendingGoalUpdates so the next upload bundles
//      profile/goal-updates.json for the cron to apply to {DATA_DIR}/profile/goals.json.
//
// On successful upload, sync.js calls clearGoalUpdates() to drain the queue. The cron
// echoes the merged canonical shape back via pwaProfile.goals on the next analysis sync,
// at which point importAnalysis (db.js) overwrites IndexedDB.goals with the canonical
// rich-shape version (rich shape is forward-compatible — narrow-shape UI components
// still read goals.calories/protein/water_oz/fiber transparently).
async function queueGoalUpdate(delta, source = 'phone-settings') {
  if (!delta || typeof delta !== 'object') return;
  const queue = (await getProfile('pendingGoalUpdates')) || [];
  queue.push({
    timestamp: Date.now(),
    source,
    delta,
  });
  await setProfile('pendingGoalUpdates', queue);
}

async function getPendingGoalUpdates() {
  return (await getProfile('pendingGoalUpdates')) || [];
}

async function clearGoalUpdates(beforeTimestamp) {
  const queue = (await getProfile('pendingGoalUpdates')) || [];
  if (queue.length === 0) return;
  // Drain only entries older than beforeTimestamp (defaults to now). This avoids
  // racing with new entries queued mid-upload.
  const cutoff = beforeTimestamp || Date.now();
  const remaining = queue.filter(e => e.timestamp > cutoff);
  if (remaining.length === queue.length) return;
  await setProfile('pendingGoalUpdates', remaining);
}

// --- Meal Plan ---

async function getMealPlan() {
  const db = await openDB();
  const tx = db.transaction('mealPlan', 'readonly');
  const store = tx.objectStore('mealPlan');
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const plans = request.result;
      if (plans.length === 0) return resolve(null);
      // Return the most recent plan.
      // Defensive: generatedDate may be a number (epoch ms) from older synthesis
      // output that emitted `generated: <epoch>` instead of an ISO date string.
      // String() coerces both to comparable strings (epoch numbers compare
      // correctly as strings within the same magnitude, and ISO dates do too).
      plans.sort((a, b) => String(b.generatedDate || '').localeCompare(String(a.generatedDate || '')));
      resolve(plans[0]);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveMealPlan(plan) {
  const db = await openDB();
  const tx = db.transaction('mealPlan', 'readwrite');
  tx.objectStore('mealPlan').put(plan);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Regimen ---

async function getRegimen() {
  return getProfile('regimen');
}

async function saveRegimen(regimen) {
  return setProfile('regimen', regimen);
}

// --- Settings (conveniences for profile key-value storage) ---

async function getProfileSetting(key) {
  return getProfile(key);
}

async function setProfileSetting(key, value) {
  return setProfile(key, value);
}

// --- Export ---

async function exportDay(dateStr) {
  const entries = await getEntriesByDate(dateStr);
  const summary = await getDailySummary(dateStr);

  // Collect photos — skip body photos here (handled separately below)
  const photoFiles = [];
  for (const entry of entries) {
    if (entry.type === 'bodyPhoto') continue;
    const photos = await getPhotos(entry.id);
    for (let i = 0; i < photos.length; i++) {
      if (photos[i].blob) {
        const suffix = photos.length > 1 ? `_${i + 1}` : '';
        photoFiles.push({
          name: `photos/${entry.id}${suffix}.jpg`,
          blob: photos[i].blob,
        });
      }
    }
  }

  // Body photos — stored under progress/ path, numbered by subtype
  const bodyPhotos = await getBodyPhotos(dateStr);
  const bpCounts = {};
  for (const bp of bodyPhotos) {
    if (bp.blob) {
      // Detect subtype from entry ID (e.g., bodyPhoto_face_123 or bodyPhoto_arms_123)
      const subtypeMatch = (bp.entryId || bp.id || '').match(/bodyPhoto_([^_]+)/);
      const subtype = subtypeMatch ? subtypeMatch[1] : 'body';
      bpCounts[subtype] = (bpCounts[subtype] || 0) + 1;
      const suffix = bpCounts[subtype] > 1 ? `_${bpCounts[subtype]}` : '';
      photoFiles.push({
        name: `body/${subtype}${suffix}.jpg`,
        blob: bp.blob,
      });
    }
  }

  // Include period state if this date falls within any period (active or historical)
  const periodState = await getProfile('period').catch(() => null);
  let periodInfo = null;
  if (periodState) {
    // Check active period
    if (periodState.active && periodState.startDate && dateStr >= periodState.startDate) {
      periodInfo = { day: Math.floor((new Date(dateStr + 'T12:00:00') - new Date(periodState.startDate + 'T12:00:00')) / 86400000) + 1 };
    }
    // Check history (for re-exports after period ended)
    if (!periodInfo && periodState.history) {
      for (const p of periodState.history) {
        if (dateStr >= p.start && dateStr <= p.end) {
          periodInfo = { day: Math.floor((new Date(dateStr + 'T12:00:00') - new Date(p.start + 'T12:00:00')) / 86400000) + 1 };
          break;
        }
      }
    }
  }

  const log = {
    date: dateStr,
    entries,
    sleep: summary.sleep || null,
    weight: summary.weight || null,
    water_oz: summary.water_oz || null,
    notes: summary.notes || null,
    coachChat: summary.coachChat || null,
    fitness_checked: summary.fitness_checked || null,
    fitness_sets: summary.fitness_sets || null,
    fitness_notes: summary.fitness_notes || null,
    period: periodInfo,
  };

  return { log, photoFiles };
}

// Get all dates that have entries but no analysis, or entries newer than analysis
async function getDatesNeedingSync() {
  const db = await openDB();
  // Get all unique entry dates and their IDs
  const entryTx = db.transaction('entries', 'readonly');
  const entries = await new Promise((resolve, reject) => {
    const req = entryTx.objectStore('entries').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
  // bodyPhoto: skip entirely — uploads fine via queueUpload but never needs analysis
  // weight: include for upload/staleness tracking, but don't check IDs against analysis.entries
  const noUploadTypes = new Set(['bodyPhoto']);
  const noAnalysisTypes = new Set(['bodyPhoto', 'weight']);
  const entryDateInfo = {};
  for (const e of entries) {
    if (!e.date || noUploadTypes.has(e.type)) continue;
    if (!entryDateInfo[e.date]) entryDateInfo[e.date] = { ids: new Set(), maxTs: 0 };
    const ts = e.updatedAt ? new Date(e.updatedAt).getTime() : (e.timestamp ? new Date(e.timestamp).getTime() : 0);
    entryDateInfo[e.date].maxTs = Math.max(entryDateInfo[e.date].maxTs, ts);
    if (!noAnalysisTypes.has(e.type)) {
      entryDateInfo[e.date].ids.add(e.id);
    }
  }

  // Check which dates have no analysis, stale analysis, or missing entries
  const needsSync = [];
  const analysisTx = db.transaction('analysis', 'readonly');
  for (const date of Object.keys(entryDateInfo)) {
    const analysis = await new Promise((resolve) => {
      const req = analysisTx.objectStore('analysis').get(date);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!analysis || !analysis.importedAt) {
      needsSync.push(date);
    } else if (entryDateInfo[date].maxTs > analysis.importedAt) {
      needsSync.push(date);
    } else {
      // Check if any local entry IDs are missing from analysis
      const analysisIds = new Set((analysis.entries || []).map(e => e.id));
      for (const id of entryDateInfo[date].ids) {
        if (!analysisIds.has(id)) { needsSync.push(date); break; }
      }
    }
  }
  return needsSync;
}

async function getAnalysisHistory(dateStr) {
  const db = await openDB();
  if (!db.objectStoreNames.contains('analysisHistory')) return [];
  const tx = db.transaction('analysisHistory', 'readonly');
  const index = tx.objectStore('analysisHistory').index('date');
  const request = index.getAll(dateStr);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

// --- Challenges ---

async function getChallenges(status) {
  const db = await openDB();
  const tx = db.transaction('challenges', 'readonly');
  if (status) {
    const index = tx.objectStore('challenges').index('status');
    const request = index.getAll(status);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }
  const request = tx.objectStore('challenges').getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getActiveChallenges() {
  return getChallenges('active');
}

async function getChallenge(id) {
  const db = await openDB();
  const tx = db.transaction('challenges', 'readonly');
  const request = tx.objectStore('challenges').get(id);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveChallenge(challenge) {
  const db = await openDB();
  const tx = db.transaction('challenges', 'readwrite');
  tx.objectStore('challenges').put(challenge);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(challenge);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function updateChallengeStatus(id, status) {
  const challenge = await getChallenge(id);
  if (!challenge) return null;
  challenge.status = status;
  if (status === 'completed' || status === 'abandoned') {
    challenge.completedDate = UI.today();
  }
  return saveChallenge(challenge);
}

async function getChallengeProgress(challengeId, date) {
  const id = challengeId + '_' + date;
  const db = await openDB();
  const tx = db.transaction('challengeProgress', 'readonly');
  const request = tx.objectStore('challengeProgress').get(id);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveChallengeProgress(progress) {
  const db = await openDB();
  const tx = db.transaction('challengeProgress', 'readwrite');
  tx.objectStore('challengeProgress').put(progress);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(progress);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getChallengeProgressRange(challengeId, startDate, endDate) {
  const db = await openDB();
  const tx = db.transaction('challengeProgress', 'readonly');
  const index = tx.objectStore('challengeProgress').index('challengeId');
  const request = index.getAll(challengeId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const all = request.result || [];
      const filtered = all.filter(p => p.date >= startDate && p.date <= endDate);
      filtered.sort((a, b) => a.date.localeCompare(b.date));
      resolve(filtered);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// --- Coach Chat History ---

// Wipe all coachChat fields from dailySummary and coachResponses from analysis.
// This is a client-side-only operation — cloud copies are not touched.
// TODO: relay-side coach data lives embedded in ZIPs (log.json) and results
// (analysis JSON coachResponses). A future endpoint DELETE /sync/{key}/coach
// would need to re-PUT each affected ZIP with coachChat stripped — significant
// scope. For now, cloud copies are not deleted; only local IndexedDB is wiped.
async function clearCoachHistory() {
  const db = await openDB();

  // 1. Strip coachChat from every dailySummary record
  const summaryTx = db.transaction('dailySummary', 'readwrite');
  const summaryStore = summaryTx.objectStore('dailySummary');
  const summaryReq = summaryStore.openCursor();
  let summaryCount = 0;

  await new Promise((resolve, reject) => {
    summaryReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const rec = cursor.value;
        if (rec.coachChat && rec.coachChat.length > 0) {
          cursor.update({ ...rec, coachChat: [] });
          summaryCount++;
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    summaryReq.onerror = (e) => reject(e.target.error);
    summaryTx.oncomplete = () => resolve();
    summaryTx.onabort = (e) => reject(e.target.error || new Error('dailySummary clear transaction aborted'));
    summaryTx.onerror = (e) => reject(e.target.error);
  });

  // 2. Strip coachResponses from every analysis record
  const analysisTx = db.transaction('analysis', 'readwrite');
  const analysisStore = analysisTx.objectStore('analysis');
  const analysisReq = analysisStore.openCursor();
  let analysisCount = 0;

  await new Promise((resolve, reject) => {
    analysisReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const rec = cursor.value;
        if (rec.coachResponses && rec.coachResponses.length > 0) {
          cursor.update({ ...rec, coachResponses: [] });
          analysisCount++;
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    analysisReq.onerror = (e) => reject(e.target.error);
    analysisTx.oncomplete = () => resolve();
    analysisTx.onabort = (e) => reject(e.target.error || new Error('analysis clear transaction aborted'));
    analysisTx.onerror = (e) => reject(e.target.error);
  });

  return { summaryCount, analysisCount };
}

// Make functions available globally
window.DB = {
  openDB,
  addEntry,
  getAllEntries,
  getEntriesByDate,
  getEntriesByDateRange,
  getEntriesByType,
  hasAnyEntries,
  updateEntry,
  updatePhotoDate,
  addPhotosToEntry,
  deleteEntry,
  getDailySummary,
  getAllDailySummaries,
  getDailySummaryRange,
  updateDailySummary,
  getPhotos,
  getBodyPhotos,
  getPhotoSyncStatus,
  clearProcessedPhotos,
  getAnalysis,
  importAnalysis,
  getAnalysisRange,
  getAnalysisHistory,
  getDatesNeedingSync,
  getProfile,
  setProfile,
  setProfileOwned,
  getProfileSetting,
  setProfileSetting,
  queueGoalUpdate,
  getPendingGoalUpdates,
  clearGoalUpdates,
  getMealPlan,
  saveMealPlan,
  getRegimen,
  saveRegimen,
  exportDay,
  getChallenges,
  getActiveChallenges,
  getChallenge,
  saveChallenge,
  updateChallengeStatus,
  getChallengeProgress,
  saveChallengeProgress,
  getChallengeProgressRange,
  clearCoachHistory,
};

