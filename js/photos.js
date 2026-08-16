// Progress photos live in IndexedDB (they're far too large for the
// localStorage document). Each photo is downscaled client-side to a
// max edge of ~1000 px JPEG so a year of monthly photos stays under a
// few MB. Keyed by date + a stable id.

const DB_NAME = 'pcal-photos';
const STORE = 'photos';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('byDate', 'date', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Downscale a File/Blob to a JPEG blob with max edge `maxPx`.
export async function downscale(file, maxPx = 1000, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob;
}

export async function addPhoto(date, file, caption = '') {
  const blob = await downscale(file);
  const photo = { id: 'p_' + crypto.randomUUID(), date, blob, caption, addedAt: Date.now() };
  await tx('readwrite', (s) => s.put(photo));
  return photo;
}

export function deletePhoto(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export function updateCaption(id, caption) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    const get = s.get(id);
    get.onsuccess = () => {
      if (get.result) { get.result.caption = caption; s.put(get.result); }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}

export async function photosOn(date) {
  const all = await allPhotos();
  return all.filter((p) => p.date === date);
}

// Oldest first.
export function allPhotos() {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.addedAt - b.addedAt)));
    req.onerror = () => reject(req.error);
  }));
}

export async function photoCount() {
  return (await allPhotos()).length;
}

// Dates that have at least one photo (for the month view's markers).
export async function photoDates() {
  const all = await allPhotos();
  return new Set(all.map((p) => p.date));
}
