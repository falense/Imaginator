// Gallery: grid of saved drawings with per-drawing PNG export and delete.

import { listDrawings, deleteDrawing } from './db.js';

export function initGallery() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');

  async function render() {
    grid.innerHTML = '';
    const drawings = await listDrawings();
    empty.classList.toggle('hidden', drawings.length > 0);

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
        const a = document.createElement('a');
        a.href = URL.createObjectURL(d.blob);
        const stamp = new Date(d.createdAt).toISOString().slice(0, 19).replace(/[T:]/g, '-');
        a.download = `drawing-${stamp}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
