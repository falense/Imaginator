// Local persistence via IndexedDB.
// 'drawings' holds finished drawings (the gallery).
// 'wip' holds one work-in-progress blob per view, so closing the app
// never loses anything.

const DB_NAME = 'imaginator';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('drawings', { keyPath: 'id', autoIncrement: true });
        req.result.createObjectStore('wip');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function op(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
      })
  );
}

export const saveDrawing = (blob, view) =>
  op('drawings', 'readwrite', (s) => s.add({ view, blob, createdAt: Date.now() }));

export const listDrawings = () =>
  op('drawings', 'readonly', (s) => s.getAll()).then((all) =>
    all.sort((a, b) => b.createdAt - a.createdAt)
  );

export const deleteDrawing = (id) => op('drawings', 'readwrite', (s) => s.delete(id));

export const saveWip = (view, blob) => op('wip', 'readwrite', (s) => s.put(blob, view));
export const getWip = (view) => op('wip', 'readonly', (s) => s.get(view));
export const clearWip = (view) => op('wip', 'readwrite', (s) => s.delete(view));
