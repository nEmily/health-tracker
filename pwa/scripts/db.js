// db.js — IndexedDB wrapper (view-agnostic data API)

const DB_NAME = 'health-tracker';
const DB_VERSION = 1;

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
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// --- Entries ---

async function addEntry(entry, photoBlob) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'photos'], 'readwrite');

  tx.objectStore('entries').put(entry);

  if (photoBlob) {
    const photoRecord = {
      id: `photo_${entry.id}`,
      entryId: entry.id,
      date: entry.date,
      category: entry.type === 'bodyPhoto' ? 'body' : 'meal',
      syncStatus: 'unsynced',
      blob: photoBlob,
      timestamp: entry.timestamp,
    };
    tx.objectStore('photos').put(photoRecord);
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
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
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
          results.push(cursor.value);
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
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const photos = request.result;
      const counts = { unsynced: 0, synced: 0, processed: 0, totalSize: 0 };
      for (const p of photos) {
        counts[p.syncStatus] = (counts[p.syncStatus] || 0) + 1;
        if (p.blob) counts.totalSize += p.blob.size || 0;
      }
      resolve(counts);
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
  const tx = db.transaction(['analysis', 'photos'], 'readwrite');
  tx.objectStore('analysis').put({ ...data, date: dateStr });

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
      // Return the most recent plan
      plans.sort((a, b) => (b.generatedDate || '').localeCompare(a.generatedDate || ''));
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

// --- Export ---

async function exportDay(dateStr) {
  const entries = await getEntriesByDate(dateStr);
  const summary = await getDailySummary(dateStr);

  // Collect photos — skip body photos here (handled separately below)
  const photoFiles = [];
  for (const entry of entries) {
    if (entry.type === 'bodyPhoto') continue;
    const photos = await getPhotos(entry.id);
    for (const photo of photos) {
      if (photo.blob) {
        photoFiles.push({
          name: `photos/${entry.id}.jpg`,
          blob: photo.blob,
        });
      }
    }
  }

  // Body photos — stored under progress/ path
  const bodyPhotos = await getBodyPhotos(dateStr);
  for (const bp of bodyPhotos) {
    if (bp.blob) {
      photoFiles.push({
        name: bp.entryId?.includes('face') || bp.id?.includes('face') ? 'body/face.jpg' : 'body/body.jpg',
        blob: bp.blob,
      });
    }
  }

  const log = {
    date: dateStr,
    entries,
    sleep: summary.sleep || null,
    weight: summary.weight || null,
    water_oz: summary.water_oz || null,
    notes: summary.notes || null,
  };

  return { log, photoFiles };
}

// Make functions available globally
window.DB = {
  openDB,
  addEntry,
  getEntriesByDate,
  getEntriesByDateRange,
  getEntriesByType,
  deleteEntry,
  getDailySummary,
  updateDailySummary,
  getPhotos,
  getBodyPhotos,
  getPhotoSyncStatus,
  clearProcessedPhotos,
  getAnalysis,
  importAnalysis,
  getAnalysisRange,
  getProfile,
  setProfile,
  getMealPlan,
  saveMealPlan,
  getRegimen,
  saveRegimen,
  exportDay,
};
