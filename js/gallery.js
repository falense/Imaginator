// Gallery: grid of saved drawings with per-drawing PNG export, delete,
// and a bulk "save all" that packs everything into one timestamped ZIP.

import { listDrawings, deleteDrawing } from './db.js';
import { makeZip } from './zip.js';

// Local-time stamp for filenames, e.g. 2026-08-01_14-32-05
function stamp(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function initGallery() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  const downloadAll = document.getElementById('gallery-download-all');

  downloadAll.addEventListener('click', async () => {
    const drawings = await listDrawings();
    if (drawings.length === 0) return;
    const names = new Set();
    const files = [];
    for (const d of drawings) {
      let name = `drawing-${stamp(d.createdAt)}.png`;
      let i = 2;
      while (names.has(name)) name = `drawing-${stamp(d.createdAt)}-${i++}.png`;
      names.add(name);
      files.push({
        name,
        data: new Uint8Array(await d.blob.arrayBuffer()),
        date: new Date(d.createdAt),
      });
    }
    downloadBlob(makeZip(files), `imaginator-drawings-${stamp(Date.now())}.zip`);
  });

  async function render() {
    grid.innerHTML = '';
    const drawings = await listDrawings();
    empty.classList.toggle('hidden', drawings.length > 0);
    downloadAll.classList.toggle('hidden', drawings.length === 0);

    for (const d of drawings) {
      const card = document.createElement('div');
      card.className = 'g-card';

      const img = new Image();
      const url = URL.createObjectURL(d.blob);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);

      const actions = document.createElement('div');
      actions.className = 'g-actions';

      const download = document.createElement('button');
      download.textContent = '⬇';
      download.title = 'Download PNG';
      download.addEventListener('click', () => {
        downloadBlob(d.blob, `drawing-${stamp(d.createdAt)}.png`);
      });

      const del = document.createElement('button');
      del.textContent = '🗑';
      del.title = 'Delete';
      del.addEventListener('click', async () => {
        if (confirm('Delete this drawing?')) {
          await deleteDrawing(d.id);
          render();
        }
      });

      actions.append(download, del);
      card.append(img, actions);
      grid.appendChild(card);
    }
  }

  return { enter: render };
}
