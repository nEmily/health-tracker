// camera.js — Photo capture + compression

const Camera = {
  // Compression presets
  presets: {
    meal: { maxDimension: 800, quality: 0.7 },
    body: { maxDimension: 1200, quality: 0.8 },
  },

  // Capture a photo using <input type="file" capture="environment">
  // Returns a promise that resolves with { blob, url } or null if cancelled
  capture(preset = 'meal') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';

      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return resolve(null);

        try {
          const compressed = await Camera.compress(file, preset);
          compressed.takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
          resolve(compressed);
        } catch (err) {
          console.error('Photo compression failed:', err);
          resolve(null);
        }
      });

      // Handle cancel (no reliable event, but change won't fire)
      input.addEventListener('cancel', () => resolve(null));

      input.click();
    });
  },

  // Pick from gallery (no capture attribute)
  pick(preset = 'meal') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return resolve(null);

        try {
          const compressed = await Camera.compress(file, preset);
          compressed.takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
          resolve(compressed);
        } catch (err) {
          console.error('Photo compression failed:', err);
          resolve(null);
        }
      });

      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },

  // Compress an image file to target dimensions and quality
  // Returns { blob, url }
  async compress(file, preset = 'meal') {
    const settings = Camera.presets[preset] || Camera.presets.meal;

    const img = await Camera.loadImage(file);

    // Calculate scaled dimensions
    let { width, height } = img;
    if (width > settings.maxDimension || height > settings.maxDimension) {
      if (width > height) {
        height = Math.round(height * (settings.maxDimension / width));
        width = settings.maxDimension;
      } else {
        width = Math.round(width * (settings.maxDimension / height));
        height = settings.maxDimension;
      }
    }

    // Draw to canvas with EXIF orientation handled by browser
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    // Convert to blob
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', settings.quality);
    });

    const url = URL.createObjectURL(blob);
    return { blob, url };
  },

  // Load a File/Blob as an HTMLImageElement
  loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  },

  // Create a preview element for a photo blob
  createPreview(url, onRemove) {
    const container = document.createElement('div');
    container.className = 'photo-preview';

    const img = document.createElement('img');
    img.src = url;
    img.className = 'photo-preview-img';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'photo-preview-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onRemove) onRemove();
      container.remove();
    });

    container.appendChild(img);
    container.appendChild(removeBtn);
    return container;
  },

  // Revoke an object URL to free memory
  revokeURL(url) {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  },
};
