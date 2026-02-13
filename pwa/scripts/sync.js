// sync.js — ZIP export + JSON import

const Sync = {
  // --- Export Day as ZIP ---
  async exportDay(dateStr) {
    const date = dateStr || App.selectedDate;

    const data = await DB.exportDay(date);
    if (!data.log.entries.length && !data.log.water_oz && !data.log.weight) {
      UI.toast('Nothing to export for this day', 'error');
      return;
    }

    UI.toast('Building export...');

    const files = [];

    // Add log.json
    const logJson = JSON.stringify(data.log, null, 2);
    files.push({ name: `daily/${date}/log.json`, data: new TextEncoder().encode(logJson) });

    // Add photos — route body photos to progress/, meal photos to daily/
    for (const photo of data.photoFiles) {
      const arrayBuf = await photo.blob.arrayBuffer();
      const isBodyPhoto = photo.name.startsWith('body/');
      const zipPath = isBodyPhoto
        ? `progress/${date}/${photo.name.replace('body/', '')}`
        : `daily/${date}/${photo.name}`;
      files.push({ name: zipPath, data: new Uint8Array(arrayBuf) });
    }

    // Build ZIP
    const zipBlob = Sync.buildZip(files);
    const fileName = `health-${date}.zip`;

    // Try Web Share API first (for iOS "Save to Files")
    if (navigator.canShare && navigator.canShare({ files: [new File([zipBlob], fileName)] })) {
      try {
        await navigator.share({
          files: [new File([zipBlob], fileName, { type: 'application/zip' })],
        });
        UI.toast('Exported! Save to iCloud Drive.');
        await Sync.markPhotosSynced(date);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled
        console.warn('Share failed, falling back to download:', err);
      }
    }

    // Fallback: download link
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast('Downloaded! Move to iCloud Drive.');
    await Sync.markPhotosSynced(date);
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

      if (!data.generatedDate || !data.days) {
        UI.toast('Invalid meal plan file', 'error');
        return;
      }

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

    try {
      const arrayBuf = await file.arrayBuffer();
      const files = Sync.readZip(new Uint8Array(arrayBuf));

      // Find log.json
      const logFile = files.find(f => f.name.endsWith('log.json'));
      if (!logFile) {
        UI.toast('No log.json found in ZIP', 'error');
        return;
      }

      const log = JSON.parse(new TextDecoder().decode(logFile.data));
      if (!log.date || !log.entries) {
        UI.toast('Invalid log format', 'error');
        return;
      }

      // Build a map of photo filenames to blobs
      const photoMap = {};
      for (const f of files) {
        if (f.name.endsWith('.jpg') || f.name.endsWith('.jpeg')) {
          photoMap[f.name] = new Blob([f.data], { type: 'image/jpeg' });
        }
      }

      // Import entries + photos
      let imported = 0;
      for (const entry of log.entries) {
        // Find matching photo
        let photoBlob = null;
        if (entry.photo) {
          // Check daily photos path and progress path
          const dailyPath = `daily/${log.date}/photos/${entry.id}.jpg`;
          const progressFace = `progress/${log.date}/face.jpg`;
          const progressBody = `progress/${log.date}/body.jpg`;

          photoBlob = photoMap[dailyPath]
            || (entry.subtype === 'face' ? photoMap[progressFace] : null)
            || (entry.subtype === 'body' ? photoMap[progressBody] : null);

          // Also try matching by entry ID prefix in filename
          if (!photoBlob) {
            const match = Object.keys(photoMap).find(k => k.includes(`/${entry.id}.`) || k.includes(`/${entry.id}/`));
            if (match) photoBlob = photoMap[match];
          }
        }

        await DB.addEntry(entry, photoBlob);
        imported++;
      }

      // Import daily summary (water, weight, sleep)
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

  // --- Smart Import (auto-detects JSON vs ZIP) ---
  async smartImport() {
    const file = await Sync.pickFile('.json,.zip');
    if (!file) return;

    if (file.name.endsWith('.zip')) {
      // Treat as backup ZIP
      UI.toast('Restoring from backup...');
      // Re-use the file by wrapping restoreFromZip logic
      const arrayBuf = await file.arrayBuffer();
      await Sync.restoreFromZipData(new Uint8Array(arrayBuf));
    } else {
      // Treat as JSON — could be analysis or meal plan
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.date && data.entries) {
        // It's an analysis summary
        await DB.importAnalysis(data.date, data);
        UI.toast(`Imported analysis for ${UI.formatDate(data.date)}`);
        if (data.date === App.selectedDate) App.loadDayView();
      } else if (data.generated && data.days) {
        // It's a meal plan
        await DB.saveMealPlan({ ...data, generatedDate: data.generated });
        UI.toast('Meal plan imported');
      } else {
        UI.toast('Unrecognized file format', 'error');
      }
    }
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
        let photoBlob = null;
        if (entry.photo) {
          const dailyPath = `daily/${log.date}/photos/${entry.id}.jpg`;
          const progressFace = `progress/${log.date}/face.jpg`;
          const progressBody = `progress/${log.date}/body.jpg`;
          photoBlob = photoMap[dailyPath]
            || (entry.subtype === 'face' ? photoMap[progressFace] : null)
            || (entry.subtype === 'body' ? photoMap[progressBody] : null);
          if (!photoBlob) {
            const match = Object.keys(photoMap).find(k => k.includes(`/${entry.id}.`) || k.includes(`/${entry.id}/`));
            if (match) photoBlob = photoMap[match];
          }
        }
        await DB.addEntry(entry, photoBlob);
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

  // --- File Picker Helper ---
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
