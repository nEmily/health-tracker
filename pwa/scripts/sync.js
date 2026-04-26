// sync.js — Cloud relay sync + ZIP import/restore

const Sync = {
  // --- Build ZIP file list for a day (used by cloud upload) ---
  async buildDayZipFiles(date) {
    const data = await DB.exportDay(date);
    if (!data.log.entries.length && !data.log.water_oz && !data.log.weight) {
      return null;
    }

    const files = [];
    const logJson = JSON.stringify(data.log, null, 2);
    files.push({ name: `daily/${date}/log.json`, data: new TextEncoder().encode(logJson) });

    // Bundle user profile so processing uses actual targets + profile survives reinstalls
    const goals = await DB.getProfile('goals');
    if (goals) {
      const hc = goals.hardcore || {};
      // Derive carb/fat targets from actual calorie budget rather than generic defaults.
      // At e.g. 850 cal / 100g protein: remaining = 450 cal → ~68g carbs, ~18g fat.
      const calTarget = goals.calories || 2000;
      const proteinG = goals.protein || 100;
      const remainingCal = Math.max(0, calTarget - proteinG * 4);
      const carbsG = Math.round((remainingCal * 0.60) / 4);
      const fatG = Math.round((remainingCal * 0.35) / 9);
      const goalsJson = JSON.stringify({
        calories: { daily: calTarget, adjustment: 'User-configured goal' },
        macros: {
          protein: { grams: proteinG, priority: 'high' },
          carbs: { grams: carbsG, priority: 'medium' },
          fat: { grams: fatG, priority: 'low' },
        },
        water: { daily_oz: goals.water_oz || 64 },
        fiber: { daily_g: goals.fiber || 25 },
        hardcore: {
          calories: { daily: hc.calories || 1500 },
          macros: { protein: { grams: hc.protein || 130 } },
          water: { daily_oz: hc.water_oz || 64 },
          fiber: { daily_g: hc.fiber || goals.fiber || 25 },
        },
      }, null, 2);
      files.push({ name: `profile/goals.json`, data: new TextEncoder().encode(goalsJson) });

      // Also bundle raw PWA profile for round-trip restore on reinstall
      const pwaProfile = {
        goals,
        supplements: await DB.getProfile('supplements'),
        bodyPhotoTypes: await DB.getProfile('bodyPhotoTypes'),
        moreOptions: await DB.getProfile('moreOptions'),
        preferences: await DB.getProfile('preferences'),
      };
      files.push({ name: `profile/pwa-profile.json`, data: new TextEncoder().encode(JSON.stringify(pwaProfile, null, 2)) });
    }

    for (const photo of data.photoFiles) {
      const arrayBuf = await photo.blob.arrayBuffer();
      const isBodyPhoto = photo.name.startsWith('body/');
      const zipPath = isBodyPhoto
        ? `progress/${date}/${photo.name.replace('body/', '')}`
        : `daily/${date}/${photo.name}`;
      files.push({ name: zipPath, data: new Uint8Array(arrayBuf) });
    }

    return files;
  },

  async markPhotosSynced(dateStr) {
    const db = await DB.openDB();
    const tx = db.transaction('photos', 'readwrite');
    const index = tx.objectStore('photos').index('date');
    const request = index.openCursor(dateStr);
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.syncStatus === 'unsynced') {
          cursor.update({ ...cursor.value, syncStatus: 'synced' });
        }
        cursor.continue();
      }
    };
  },

  // --- Import Analysis ---
  async importAnalysis() {
    const file = await Sync.pickFile('.json');
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.date) {
        UI.toast('Invalid analysis file — no date field', 'error');
        return;
      }

      await DB.importAnalysis(data.date, data);
      UI.toast(`Imported analysis for ${UI.formatDate(data.date)}`);

      // Refresh view if we're on that date
      if (data.date === App.selectedDate) {
        App.loadDayView();
      }
    } catch (err) {
      console.error('Import failed:', err);
      UI.toast('Failed to import — check file format', 'error');
    }
  },

  // --- Import Meal Plan ---
  async importMealPlan() {
    const file = await Sync.pickFile('.json');
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.days || (!data.generatedDate && !data.generated)) {
        UI.toast('Invalid meal plan file', 'error');
        return;
      }

      if (!data.generatedDate) data.generatedDate = data.generated;
      await DB.saveMealPlan(data);
      UI.toast('Meal plan imported');
    } catch (err) {
      console.error('Meal plan import failed:', err);
      UI.toast('Failed to import meal plan', 'error');
    }
  },

  // --- Restore from ZIP backup ---
  async restoreFromZip() {
    const file = await Sync.pickFile('.zip');
    if (!file) return;

    UI.toast('Restoring from backup...');
    const arrayBuf = await file.arrayBuffer();
    await Sync.restoreFromZipData(new Uint8Array(arrayBuf));
  },

  // --- Import All (multi-file, auto-detects type) ---
  async importAll() {
    const files = await Sync.pickFiles('.json,.zip');
    if (!files || files.length === 0) return;

    let analysisCount = 0, mealPlanCount = 0, zipCount = 0, errors = 0;

    for (const file of files) {
      try {
        if (file.name.endsWith('.zip')) {
          const arrayBuf = await file.arrayBuffer();
          await Sync.restoreFromZipData(new Uint8Array(arrayBuf));
          zipCount++;
        } else {
          const text = await file.text();
          const data = JSON.parse(text);

          if (data.date && data.entries) {
            await DB.importAnalysis(data.date, data);
            analysisCount++;
          } else if (data.days && (data.generated || data.generatedDate)) {
            if (!data.generatedDate) data.generatedDate = data.generated;
            await DB.saveMealPlan(data);
            mealPlanCount++;
          } else {
            console.warn('Skipped unrecognized file:', file.name);
            errors++;
          }
        }
      } catch (err) {
        console.error(`Failed to import ${file.name}:`, err);
        errors++;
      }
    }

    const parts = [];
    if (analysisCount) parts.push(`${analysisCount} analysis`);
    if (mealPlanCount) parts.push(`${mealPlanCount} meal plan`);
    if (zipCount) parts.push(`${zipCount} backup`);
    if (errors) parts.push(`${errors} skipped`);
    UI.toast(parts.length ? `Imported: ${parts.join(', ')}` : 'No files imported', parts.length ? 'success' : 'error');

    App.loadDayView();
  },

  async restoreFromZipData(zipBytes) {
    try {
      const files = Sync.readZip(zipBytes);
      const logFile = files.find(f => f.name.endsWith('log.json'));
      if (!logFile) { UI.toast('No log.json found in ZIP', 'error'); return; }

      const log = JSON.parse(new TextDecoder().decode(logFile.data));
      if (!log.date || !log.entries) { UI.toast('Invalid log format', 'error'); return; }

      const photoMap = {};
      for (const f of files) {
        if (f.name.endsWith('.jpg') || f.name.endsWith('.jpeg')) {
          photoMap[f.name] = new Blob([f.data], { type: 'image/jpeg' });
        }
      }

      let imported = 0;
      for (const entry of log.entries) {
        let photoBlobs = null;
        if (entry.photo) {
          const blobs = [];
          // Primary photo path
          const dailyPath = `daily/${log.date}/photos/${entry.id}.jpg`;
          if (photoMap[dailyPath]) blobs.push(photoMap[dailyPath]);

          // Additional photos (e.g., photos/entry_id_2.jpg, photos/entry_id_3.jpg)
          for (let n = 2; n <= 10; n++) {
            const extraPath = `daily/${log.date}/photos/${entry.id}_${n}.jpg`;
            if (photoMap[extraPath]) blobs.push(photoMap[extraPath]);
            else break;
          }

          // Fallback for body photos
          if (blobs.length === 0 && entry.type === 'bodyPhoto') {
            const progressPath = `progress/${log.date}/${entry.subtype || 'body'}.jpg`;
            if (photoMap[progressPath]) blobs.push(photoMap[progressPath]);
          }

          // Generic fallback: match by entry ID
          if (blobs.length === 0) {
            const matches = Object.keys(photoMap).filter(k => k.includes(`/${entry.id}`));
            for (const match of matches) blobs.push(photoMap[match]);
          }

          photoBlobs = blobs.length > 0 ? blobs : null;
        }
        await DB.addEntry(entry, photoBlobs);
        imported++;
      }

      const summaryUpdates = {};
      if (log.water_oz != null) summaryUpdates.water_oz = log.water_oz;
      if (log.weight != null) summaryUpdates.weight = log.weight;
      if (log.sleep != null) summaryUpdates.sleep = log.sleep;
      if (Object.keys(summaryUpdates).length > 0) {
        await DB.updateDailySummary(log.date, summaryUpdates);
      }

      UI.toast(`Restored ${imported} entries for ${UI.formatDate(log.date)}`);
      if (log.date === App.selectedDate) App.loadDayView();
    } catch (err) {
      console.error('Restore failed:', err);
      UI.toast('Restore failed — check ZIP format', 'error');
    }
  },

  // --- Minimal ZIP Reader (for uncompressed/STORE ZIPs) ---
  readZip(zipBytes) {
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    const files = [];
    let offset = 0;

    while (offset < zipBytes.length - 4) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break; // Not a local file header

      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const nameBytes = zipBytes.slice(offset + 30, offset + 30 + nameLen);
      const name = new TextDecoder().decode(nameBytes);
      const dataStart = offset + 30 + nameLen + extraLen;
      if (dataStart + compressedSize > zipBytes.length) break; // Truncated ZIP
      const data = zipBytes.slice(dataStart, dataStart + compressedSize);

      if (!name.endsWith('/')) { // Skip directory entries
        files.push({ name, data });
      }

      offset = dataStart + compressedSize;
    }

    return files;
  },

  // --- File Picker Helpers ---
  pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*';
      input.addEventListener('change', () => resolve(input.files[0] || null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },

  pickFiles(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*';
      input.multiple = true;
      input.addEventListener('change', () => resolve(Array.from(input.files)));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },

  // --- Photo Cleanup ---
  async getStorageInfo() {
    const status = await DB.getPhotoSyncStatus();
    return {
      unsynced: status.unsynced || 0,
      synced: status.synced || 0,
      processed: status.processed || 0,
      totalSizeMB: ((status.totalSize || 0) / (1024 * 1024)).toFixed(1),
    };
  },

  async clearProcessedPhotos() {
    const count = await DB.clearProcessedPhotos();
    UI.toast(`Cleared ${count} processed photo${count !== 1 ? 's' : ''}`);
    return count;
  },

  // --- Minimal ZIP Builder (no dependencies) ---
  // Creates a valid ZIP file from an array of { name: string, data: Uint8Array }
  buildZip(files) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = new TextEncoder().encode(file.name);
      const crc = Sync.crc32(file.data);
      const size = file.data.length;

      // Local file header (30 bytes + name + data)
      const local = new Uint8Array(30 + nameBytes.length + size);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // signature
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0, true);             // flags
      lv.setUint16(8, 0, true);             // compression (store)
      lv.setUint16(10, 0, true);            // mod time
      lv.setUint16(12, 0, true);            // mod date
      lv.setUint32(14, crc, true);          // crc32
      lv.setUint32(18, size, true);         // compressed size
      lv.setUint32(22, size, true);         // uncompressed size
      lv.setUint16(26, nameBytes.length, true); // name length
      lv.setUint16(28, 0, true);            // extra length
      local.set(nameBytes, 30);
      local.set(file.data, 30 + nameBytes.length);
      localHeaders.push(local);

      // Central directory header (46 bytes + name)
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);   // signature
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0, true);             // flags
      cv.setUint16(10, 0, true);            // compression
      cv.setUint16(12, 0, true);            // mod time
      cv.setUint16(14, 0, true);            // mod date
      cv.setUint32(16, crc, true);          // crc32
      cv.setUint32(20, size, true);         // compressed size
      cv.setUint32(24, size, true);         // uncompressed size
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);            // extra length
      cv.setUint16(32, 0, true);            // comment length
      cv.setUint16(34, 0, true);            // disk start
      cv.setUint16(36, 0, true);            // internal attributes
      cv.setUint32(38, 0, true);            // external attributes
      cv.setUint32(42, offset, true);       // local header offset
      central.set(nameBytes, 46);
      centralHeaders.push(central);

      offset += local.length;
    }

    // End of central directory
    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const c of centralHeaders) centralDirSize += c.length;

    const endRecord = new Uint8Array(22);
    const ev = new DataView(endRecord.buffer);
    ev.setUint32(0, 0x06054b50, true);     // signature
    ev.setUint16(4, 0, true);               // disk number
    ev.setUint16(6, 0, true);               // central dir disk
    ev.setUint16(8, files.length, true);     // entries on disk
    ev.setUint16(10, files.length, true);    // total entries
    ev.setUint32(12, centralDirSize, true);  // central dir size
    ev.setUint32(16, centralDirOffset, true); // central dir offset
    ev.setUint16(20, 0, true);               // comment length

    // Combine all parts
    const totalSize = offset + centralDirSize + 22;
    const zip = new Uint8Array(totalSize);
    let pos = 0;
    for (const l of localHeaders) { zip.set(l, pos); pos += l.length; }
    for (const c of centralHeaders) { zip.set(c, pos); pos += c.length; }
    zip.set(endRecord, pos);

    return new Blob([zip], { type: 'application/zip' });
  },

  // CRC32 calculation
  _crc32Table: null,
  crc32(data) {
    if (!Sync._crc32Table) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
      }
      Sync._crc32Table = table;
    }

    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = Sync._crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },
};

// --- Cloud Relay Sync ---
// Zero-tap sync via Cloudflare Worker + R2
const CloudRelay = {
  _uploadTimer: null,
  _pollTimer: null,
  _pendingDate: null,
  _log: [], // Recent sync events visible in settings

  log(msg, level = 'info') {
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    // Mask sync key in log output (show first 8 chars only)
    const masked = msg.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '$1...');
    this._log.push({ time, msg: masked, level });
    if (this._log.length > 20) this._log.shift();
    console[level === 'error' ? 'error' : 'log'](`CloudRelay: ${masked}`);
    const el = document.getElementById('cloud-sync-log');
    if (el) this._renderLog(el);
  },

  _renderLog(el) {
    const colors = { info: 'var(--text-muted)', error: 'var(--accent-red)', ok: 'var(--accent-green)' };
    el.innerHTML = this._log.slice().reverse().map(e =>
      `<div style="color: ${colors[e.level] || colors.info}"><span style="opacity: 0.6">${UI.escapeHtml(e.time)}</span> ${UI.escapeHtml(e.msg)}</div>`
    ).join('');
  },

  // Persistent sync event log — survives page reloads for debugging
  logSyncEvent(event, date, detail) {
    try {
      const log = JSON.parse(localStorage.getItem('syncEventLog') || '[]');
      log.push({
        t: Date.now(),
        event,
        date: date || null,
        detail: detail || null,
      });
      // Cap at 100 events (rolling window)
      if (log.length > 100) log.splice(0, log.length - 100);
      localStorage.setItem('syncEventLog', JSON.stringify(log));
    } catch (e) { /* localStorage may be unavailable */ }
  },

  getSyncEventLog() {
    try {
      return JSON.parse(localStorage.getItem('syncEventLog') || '[]');
    } catch (e) { return []; }
  },

  // Get relay config from IndexedDB
  async getConfig() {
    return await DB.getProfile('cloudRelay') || null;
  },

  async saveConfig(config) {
    await DB.setProfile('cloudRelay', config);
    // Backup to localStorage — survives app reinstall on some platforms
    try {
      localStorage.setItem('cloudRelay_backup', JSON.stringify(config));
    } catch (e) { /* localStorage may be unavailable */ }
  },

  async isConfigured() {
    const config = await this.getConfig();
    return !!(config && config.workerUrl && config.syncKey);
  },

  // Start polling for results every 5 minutes (stops after 1 hour or when results arrive)
  _gotResults: false,
  startPolling() {
    if (this._pollTimer || this._gotResults) return;
    let checks = 0;
    const maxChecks = 12; // 12 x 5min = 1 hour
    this._pollTimer = setInterval(async () => {
      checks++;
      if (checks > maxChecks) {
        this.stopPolling();
        return;
      }
      try {
        await this.checkForResults();
      } catch (e) { /* silent */ }
    }, 5 * 60 * 1000);
    this.log('Started polling for results (every 5 min)');
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      this.log('Stopped polling');
    }
  },

  // Queue a day for upload (debounced — batches saves within 3s)
  queueUpload(dateStr) {
    if (!this._pendingDates) this._pendingDates = new Set();
    this._pendingDates.add(dateStr);
    this.log(`Queued ${dateStr} for upload (3s debounce)`);
    if (this._uploadTimer) clearTimeout(this._uploadTimer);
    this._uploadTimer = setTimeout(() => this._doUploadAll(), 3000);
  },

  async _doUploadAll() {
    const dates = this._pendingDates;
    this._pendingDates = new Set();
    if (!dates || dates.size === 0) return;
    for (const date of dates) {
      await this._doUpload(date);
    }
    // If new dates were queued during uploads, process them too
    if (this._pendingDates.size > 0) {
      await this._doUploadAll();
    }
  },

  async _doUpload(date) {
    if (!date) return;

    const config = await this.getConfig();
    if (!config || !config.workerUrl || !config.syncKey) {
      this.log('Upload skipped — not configured', 'error');
      return;
    }

    try {
      CloudRelay.setSyncStatus('uploading');
      this.log(`Building ZIP for ${date}...`);
      const files = await Sync.buildDayZipFiles(date);
      if (!files) {
        this.log(`No data for ${date}, skipping`);
        return;
      }

      this.log(`ZIP: ${files.length} file(s), uploading to relay...`);
      const zipBlob = Sync.buildZip(files);
      const arrayBuf = await zipBlob.arrayBuffer();
      this.log(`ZIP size: ${(arrayBuf.byteLength / 1024).toFixed(1)} KB`);

      const url = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/day/${date}`;
      this.log(`PUT ${url}`);
      const resp = await fetch(url, {
        method: 'PUT',
        body: arrayBuf,
      });

      if (resp.ok) {
        await Sync.markPhotosSynced(date);
        CloudRelay.setSyncStatus('synced');
        CloudRelay.recordUploadTime(date);
        this.log(`Uploaded ${date} successfully`, 'ok');
        // Refresh day view so "pending upload" badges clear
        if (typeof App !== 'undefined' && date === App.selectedDate) App.loadDayView();
        // Check for results — if none found, start polling for future results
        this._gotResults = false;
        this.checkForResults().then(() => {
          this.startPolling(); // No-op if _gotResults was set by checkForResults
        }).catch(() => {
          this.startPolling();
        });
      } else {
        const body = await resp.text().catch(() => '');
        this.log(`Upload failed: HTTP ${resp.status} ${body}`, 'error');
        CloudRelay.setSyncStatus('error');
      }
    } catch (err) {
      this.log(`Upload error: ${err.message}`, 'error');
      CloudRelay.setSyncStatus('error');
      // Re-queue for retry on reconnect (persistent via getDatesNeedingSync)
      UI.toast('Sync failed — will retry when online', 'error');
    }
  },

  // Check for new analysis results from the relay
  _checkingResults: false,
  async checkForResults() {
    // Mutex — prevent concurrent checks from racing on download/import/ack
    if (this._checkingResults) {
      this.log('Results check already in progress — skipping');
      return;
    }
    this._checkingResults = true;

    const config = await this.getConfig();
    if (!config || !config.workerUrl || !config.syncKey) {
      this.log('Results check skipped — not configured');
      this._checkingResults = false;
      return;
    }

    const baseUrl = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}`;

    try {
      const resultsUrl = `${baseUrl}/results/new`;
      this.log(`Checking: ${resultsUrl}`);
      const resp = await fetch(resultsUrl);
      if (!resp.ok) {
        this.log(`Results check failed: HTTP ${resp.status}`, 'error');
        this._checkingResults = false;
        return;
      }

      const data = await resp.json();
      const newResults = data.newResults;

      // Check for script version update notification
      if (data.scriptVersion) {
        this._checkScriptVersion(data.scriptVersion);
      }

      if (!newResults || newResults.length === 0) {
        this.log('No new results available');
        this._checkingResults = false;
        return;
      }

      this.log(`Found ${newResults.length} result(s): ${newResults.join(', ')}`);
      this._gotResults = true;
      this.stopPolling();

      // Phase 1: Download, import, and verify — collect confirmed dates
      const verified = [];
      const failed = [];

      for (const date of newResults) {
        try {
          const dlUrl = `${baseUrl}/results/${date}`;
          this.log(`Downloading ${date}...`);
          const resultResp = await fetch(dlUrl);
          if (!resultResp.ok) {
            this.log(`Failed to download ${date}: HTTP ${resultResp.status}`, 'error');
            failed.push(date);
            this.logSyncEvent('download_fail', date, `HTTP ${resultResp.status}`);
            continue;
          }

          // Use text + JSON.parse for better error diagnostics than .json()
          const text = await resultResp.text();
          let analysis;
          try {
            analysis = JSON.parse(text);
          } catch (parseErr) {
            this.log(`Invalid JSON for ${date}: ${parseErr.message} (first 100 chars: ${text.slice(0, 100)})`, 'error');
            failed.push(date);
            this.logSyncEvent('parse_fail', date, parseErr.message);
            continue;
          }

          await DB.importAnalysis(date, analysis);

          // Verify the import actually persisted in IDB
          const stored = await DB.getAnalysis(date);
          if (!stored || !stored.importedAt) {
            this.log(`Import verification FAILED for ${date} — data not in IDB after importAnalysis`, 'error');
            failed.push(date);
            this.logSyncEvent('verify_fail', date, 'not found in IDB after import');
            continue;
          }

          this.log(`Imported and verified ${date}`, 'ok');
          verified.push(date);
          this.recordUploadTime(date); // keep localStorage cache fresh so badges clear immediately
          this.logSyncEvent('import_ok', date);
        } catch (innerErr) {
          this.log(`Error processing ${date}: ${innerErr.message}`, 'error');
          failed.push(date);
          this.logSyncEvent('import_error', date, innerErr.message);
        }
      }

      // Phase 2: Ack only verified imports — unverified dates stay in relay queue for retry
      for (const date of verified) {
        try {
          await fetch(`${baseUrl}/results/${date}/ack`, { method: 'POST' });
          this.log(`Ack sent for ${date}`, 'ok');
        } catch (ackErr) {
          // Ack failure is safe — relay keeps the date, we'll re-import (idempotent)
          this.log(`Ack failed for ${date}: ${ackErr.message} — will retry`, 'error');
          this.logSyncEvent('ack_fail', date, ackErr.message);
        }
      }

      if (failed.length > 0) {
        this.log(`${failed.length} date(s) failed — will retry on next check: ${failed.join(', ')}`, 'error');
      }

      // Refresh view if any verified dates match current view
      if (verified.some(d => d === App.selectedDate)) App.loadDayView();

      if (verified.length > 0) {
        UI.toast(`${verified.length} day(s) of analysis imported`);
      } else if (failed.length > 0) {
        UI.toast(`Analysis import failed — will retry`, 'error');
      }
    } catch (err) {
      this.log(`Results check error: ${err.message}`, 'error');
      this.logSyncEvent('check_error', null, err.message);
    } finally {
      this._checkingResults = false;
    }
  },

  // Track last successful upload time per date (used by UI to show pending-upload badges)
  recordUploadTime(date) {
    try {
      const times = JSON.parse(localStorage.getItem('coachSyncTimes') || '{}');
      times[date] = Date.now();
      localStorage.setItem('coachSyncTimes', JSON.stringify(times));
    } catch (e) { /* localStorage may be unavailable */ }
  },

  getLastSyncTime(date) {
    try {
      const times = JSON.parse(localStorage.getItem('coachSyncTimes') || '{}');
      return times[date] || 0;
    } catch (e) { return 0; }
  },

  // Sync status indicator in header
  setSyncStatus(status) {
    let indicator = document.getElementById('sync-status');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'sync-status';
      indicator.style.cssText = 'font-size: 12px; position: absolute; right: 8px; top: 50%; transform: translateY(-50%);';
      const header = document.querySelector('.app-header');
      if (header) {
        header.style.position = 'relative';
        header.appendChild(indicator);
      }
    }

    const labels = { uploading: 'Syncing', synced: 'Synced', error: '!', pending: '...' };
    indicator.textContent = labels[status] || '';
    if (status === 'synced') {
      setTimeout(() => { if (indicator.textContent === labels.synced) indicator.textContent = ''; }, 3000);
    }
  },

  // Fetch health data (steps etc.) from relay for a given date
  async getHealthData(date) {
    const config = await this.getConfig();
    if (!config || !config.workerUrl || !config.syncKey) return null;
    try {
      const url = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/health/${date}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  },

  // Re-sync all results from relay (for reinstall recovery)
  async resyncAll() {
    const config = await this.getConfig();
    if (!config || !config.workerUrl || !config.syncKey) {
      UI.toast('Cloud Sync not configured');
      return;
    }
    try {
      this.log('Requesting resync of all results...');
      const url = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/results/resync`;
      const resp = await fetch(url, { method: 'POST' });
      if (!resp.ok) {
        this.log(`Resync failed: HTTP ${resp.status}`, 'error');
        UI.toast('Resync failed', 'error');
        return;
      }
      const { resyncDates } = await resp.json();
      this.log(`Resync queued ${resyncDates.length} date(s): ${resyncDates.join(', ')}`, 'ok');
      UI.toast(`Re-syncing ${resyncDates.length} day(s)...`);
      await this.checkForResults();
      App.loadDayView();
    } catch (err) {
      this.log(`Resync error: ${err.message}`, 'error');
      UI.toast('Resync failed', 'error');
    }
  },

  // Full sync — download ALL raw data from relay for dates missing locally
  async fullSync() {
    const config = await this.getConfig();
    if (!config || !config.workerUrl || !config.syncKey) {
      UI.toast('Cloud Sync not configured', 'error');
      return;
    }

    const isValidDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);

    try {
      this.log('Full sync: fetching date list from relay...');
      const datesResp = await fetch(`${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/dates`);
      if (!datesResp.ok) {
        this.log(`Full sync: dates fetch failed: HTTP ${datesResp.status}`, 'error');
        UI.toast('Full sync failed — could not list relay dates', 'error');
        return;
      }

      const { dates } = await datesResp.json();
      const validDates = (dates || []).filter(isValidDate);
      if (validDates.length === 0) {
        this.log('Full sync: no dates found on relay');
        UI.toast('No data on relay to sync');
        return;
      }

      this.log(`Full sync: relay has ${validDates.length} date(s)`);

      // Determine which dates are missing locally
      const missingDates = [];
      for (const date of validDates) {
        const localEntries = await DB.getEntriesByDate(date);
        if (!localEntries || localEntries.length === 0) {
          missingDates.push(date);
        }
      }

      if (missingDates.length === 0) {
        this.log('Full sync: all relay dates already present locally', 'ok');
        UI.toast('Already up to date — no missing days found');
        // Still pull any pending results
        await this.checkForResults();
        return;
      }

      this.log(`Full sync: downloading ${missingDates.length} missing date(s)...`);
      let done = 0;
      let failed = 0;

      for (const date of missingDates) {
        // Update progress toast every date
        UI.toast(`Syncing ${done + 1}/${missingDates.length} days...`);
        try {
          const r = await fetch(`${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/day/${date}`);
          if (r.ok) {
            await Sync.restoreFromZipData(new Uint8Array(await r.arrayBuffer()));
            this.log(`Full sync: restored ${date}`, 'ok');
            done++;
          } else {
            this.log(`Full sync: ${date} fetch failed: HTTP ${r.status}`, 'error');
            failed++;
          }
        } catch (err) {
          this.log(`Full sync: ${date} error: ${err.message}`, 'error');
          failed++;
        }
      }

      // Pull any pending analysis results too
      await this.checkForResults();

      const msg = failed > 0
        ? `Synced ${done} day(s), ${failed} failed`
        : `Synced ${done} day(s)`;
      UI.toast(msg, failed > 0 ? 'error' : 'success');
      this.log(`Full sync complete: ${done} restored, ${failed} failed`, failed > 0 ? 'error' : 'ok');
      App.loadDayView();
    } catch (err) {
      this.log(`Full sync error: ${err.message}`, 'error');
      UI.toast('Full sync failed', 'error');
    }
  },

  // Delete a single day from relay
  async deleteDayFromRelay(date) {
    const config = await this.getConfig();
    if (!config?.workerUrl || !config?.syncKey) return;
    try {
      const url = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/day/${date}`;
      const resp = await fetch(url, { method: 'DELETE' });
      if (resp.ok) this.log(`Deleted ${date} from relay`, 'ok');
      else this.log(`Failed to delete ${date} from relay: HTTP ${resp.status}`, 'error');
    } catch (err) {
      this.log(`Relay delete error: ${err.message}`, 'error');
    }
  },

  // Delete ALL data from relay
  async deleteAllFromRelay() {
    const config = await this.getConfig();
    if (!config?.workerUrl || !config?.syncKey) return;
    try {
      const url = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/all`;
      const resp = await fetch(url, { method: 'DELETE' });
      if (resp.ok) {
        const { deleted } = await resp.json();
        this.log(`Deleted ${deleted} files from relay`, 'ok');
        UI.toast(`Relay data deleted (${deleted} files)`);
      } else {
        this.log(`Relay delete all failed: HTTP ${resp.status}`, 'error');
      }
    } catch (err) {
      this.log(`Relay delete all error: ${err.message}`, 'error');
    }
  },

  // Show sync setup modal
  async showSetup() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const config = await this.getConfig() || {};

    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Cloud Sync Setup</span>
        <button class="modal-close" id="cs-close" aria-label="Close">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Worker URL</label>
        <input type="url" class="form-input" id="cs-url" value="${UI.escapeHtml(config.workerUrl || '')}" placeholder="https://health-sync.your-account.workers.dev">
      </div>
      <div class="form-group">
        <label class="form-label">Sync Key</label>
        <input type="text" class="form-input" id="cs-key" value="${UI.escapeHtml(config.syncKey || '')}" placeholder="UUID sync key">
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="cs-save">Save</button>
      ${config.syncKey ? '<button class="btn btn-secondary btn-block" id="cs-test" style="margin-top: var(--space-sm);">Test Connection</button>' : ''}
      <button class="btn btn-secondary btn-block" id="cs-sync-now" style="margin-top: var(--space-sm);">Sync Now</button>
      <button class="btn btn-secondary btn-block" id="cs-check-results" style="margin-top: var(--space-xs);">Check for Results</button>
      <button class="btn btn-ghost btn-block" id="cs-resync" style="margin-top: var(--space-xs);">Re-sync All Results</button>
      <button class="btn btn-secondary btn-block" id="cs-full-sync" style="margin-top: var(--space-xs);">Full Sync (Download All Raw Data)</button>
      <div style="margin-top: var(--space-md);">
        <label class="form-label">Sync Log</label>
        <div id="cloud-sync-log" style="font-size: var(--text-xs); font-family: monospace; max-height: 200px; overflow-y: auto; padding: var(--space-sm); background: var(--bg-secondary); border-radius: var(--radius-sm);"></div>
      </div>
      <div style="margin-top: var(--space-sm);">
        <label class="form-label">Event History <span style="opacity:0.5">(persists across reloads)</span></label>
        <div id="cloud-sync-events" style="font-size: var(--text-xs); font-family: monospace; max-height: 150px; overflow-y: auto; padding: var(--space-sm); background: var(--bg-secondary); border-radius: var(--radius-sm);"></div>
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    document.getElementById('cs-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('cs-save').addEventListener('click', async () => {
      const workerUrl = document.getElementById('cs-url')?.value?.trim().replace(/\/$/, '') || '';
      const syncKey = document.getElementById('cs-key')?.value?.trim() || '';
      if (!workerUrl || !syncKey) {
        UI.toast('Fill in both fields', 'error');
        return;
      }
      await CloudRelay.saveConfig({ workerUrl, syncKey });
      UI.toast('Cloud sync configured');
      closeModal();
      Settings.loadCloudSyncStatus();
    });

    // Render existing log entries
    const logEl = document.getElementById('cloud-sync-log');
    if (logEl) {
      if (CloudRelay._log.length === 0) {
        logEl.innerHTML = '<div style="color: var(--text-muted)">No sync activity yet</div>';
      } else {
        CloudRelay._renderLog(logEl);
      }
    }

    // Render persistent event history
    const eventsEl = document.getElementById('cloud-sync-events');
    if (eventsEl) {
      const events = CloudRelay.getSyncEventLog();
      if (events.length === 0) {
        eventsEl.innerHTML = '<div style="color: var(--text-muted)">No events recorded</div>';
      } else {
        const colors = { import_ok: 'var(--accent-green)', check_error: 'var(--accent-red)',
          download_fail: 'var(--accent-red)', parse_fail: 'var(--accent-red)',
          verify_fail: 'var(--accent-red)', import_error: 'var(--accent-red)',
          ack_fail: 'var(--accent-yellow, orange)' };
        eventsEl.innerHTML = events.slice().reverse().map(e => {
          const time = new Date(e.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          const color = colors[e.event] || 'var(--text-muted)';
          const detail = e.detail ? ` — ${UI.escapeHtml(e.detail)}` : '';
          return `<div style="color: ${color}"><span style="opacity: 0.6">${UI.escapeHtml(time)}</span> ${UI.escapeHtml(e.event)}${e.date ? ` [${UI.escapeHtml(e.date)}]` : ''}${detail}</div>`;
        }).join('');
      }
    }

    document.getElementById('cs-sync-now').addEventListener('click', async () => {
      clearTimeout(CloudRelay._uploadTimer);
      CloudRelay._uploadTimer = null;
      const dates = await DB.getDatesNeedingSync();
      const today = UI.today();
      if (!dates.includes(today)) dates.push(today);
      const viewed = App.selectedDate;
      if (viewed && !dates.includes(viewed)) dates.push(viewed);
      CloudRelay.log(`Manual sync: uploading ${dates.length} date(s): ${dates.join(', ')}`);
      for (const date of dates) {
        await CloudRelay._doUpload(date);
      }
      await CloudRelay.checkForResults();
    });

    document.getElementById('cs-check-results').addEventListener('click', async () => {
      UI.toast('Checking for results...');
      CloudRelay._gotResults = false;
      await CloudRelay.checkForResults();
      if (!CloudRelay._gotResults) {
        UI.toast('No new results on relay');
      }
    });

    document.getElementById('cs-resync')?.addEventListener('click', async () => {
      await CloudRelay.resyncAll();
    });

    document.getElementById('cs-full-sync')?.addEventListener('click', async () => {
      await CloudRelay.fullSync();
    });

    document.getElementById('cs-test')?.addEventListener('click', async () => {
      const url = document.getElementById('cs-url')?.value?.trim().replace(/\/$/, '');
      const key = document.getElementById('cs-key')?.value?.trim();
      if (!url || !key) { UI.toast('Fill in both fields', 'error'); return; }
      try {
        const resp = await fetch(`${url}/sync/${key}/pending`);
        if (resp.ok) UI.toast('Connected!');
        else UI.toast(`Error: ${resp.status}`, 'error');
      } catch (err) {
        UI.toast('Connection failed', 'error');
      }
    });
  },

  // Script version update detection
  _updateBannerShown: false,

  async _checkScriptVersion(relayVersion) {
    if (this._updateBannerShown) return;
    try {
      const profile = await DB.getProfile();
      const localVersion = profile?.scriptVersion;
      if (!localVersion) return; // not set yet (pre-plugin users)
      if (localVersion === relayVersion) return;
      this._updateBannerShown = true;
      this.log(`Script update available: ${localVersion} -> ${relayVersion}`);
      this._showUpdateBanner(relayVersion);
    } catch (e) { /* silent */ }
  },

  _showUpdateBanner(version) {
    if (document.getElementById('update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span>Coach update available (v${version}). Run <code>/setup</code> to update processing scripts.</span>
      <button onclick="this.parentElement.remove()">Dismiss</button>
    `;
    document.body.prepend(banner);
  },
};

