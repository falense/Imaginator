// Coloring view: predefined line-art pages to color in. The line art is an
// <img> overlaid on the drawing canvas with mix-blend-mode: multiply, so the
// outlines always stay on top and the eraser can never damage them — kids
// color "under" the lines like in a real coloring book. Prev/next cycle
// through the pages; each page keeps its own work-in-progress.

import { DrawingEngine } from './engine.js';
import { saveDrawing, saveWip, getWip, clearWip } from './db.js';
import { holdAction, toast, hueSlider } from './ui.js';

const IMAGES = [
  'assets/coloring/coloring-01.png', // unicorn under a rainbow
  'assets/coloring/coloring-02.png', // dinosaur in a meadow
  'assets/coloring/coloring-03.png', // unicorn flying over clouds
  'assets/coloring/coloring-04.png', // kitten with yarn
  'assets/coloring/coloring-05.png', // baby unicorn with butterflies
  'assets/coloring/coloring-06.png', // rocket and smiling planet
  'assets/coloring/coloring-07.png', // unicorn and castle
  'assets/coloring/coloring-08.png', // fish under the sea
  'assets/coloring/coloring-09.png', // unicorn birthday party
  'assets/coloring/coloring-10.png', // tractor on the farm
];

export function initColoring() {
  const engine = new DrawingEngine(document.getElementById('coloring-canvas'));
  const root = document.getElementById('coloring');
  const art = document.getElementById('coloring-art');
  engine.color = 'hsl(0 90% 45%)';

  let index = Math.min(IMAGES.length - 1, Number(localStorage.getItem('coloring-index')) || 0);

  const wipKey = () => `coloring-${index}`;

  let wipTimer = null;
  const scheduleWipSave = () => {
    clearTimeout(wipTimer);
    const key = wipKey();
    wipTimer = setTimeout(async () => {
      if (engine.hasContent()) saveWip(key, await engine.toBlob());
      else clearWip(key);
    }, 800);
  };
  engine.onChange = scheduleWipSave;

  async function stashWip() {
    clearTimeout(wipTimer);
    if (engine.hasContent()) await saveWip(wipKey(), await engine.toBlob());
    else await clearWip(wipKey());
  }

  async function showPicture(i, { stash = true } = {}) {
    if (stash) await stashWip();
    index = (i + IMAGES.length) % IMAGES.length;
    localStorage.setItem('coloring-index', index);
    art.src = IMAGES[index];
    engine.clear();
    const wip = await getWip(wipKey());
    if (wip) await engine.restore(wip);
  }

  // The rect the line art occupies on the canvas (CSS object-fit: contain).
  function artRect(w, h) {
    const scale = Math.min(w / art.naturalWidth, h / art.naturalHeight);
    const aw = art.naturalWidth * scale;
    const ah = art.naturalHeight * scale;
    return { x: (w - aw) / 2, y: (h - ah) / 2, w: aw, h: ah };
  }

  // Gallery export: the colored strokes with the line art multiplied on top,
  // matching exactly what is on screen.
  async function compositeBlob() {
    await art.decode().catch(() => {});
    const blob = await engine.toBlob();
    const bitmap = await createImageBitmap(blob);
    const out = document.createElement('canvas');
    out.width = bitmap.width;
    out.height = bitmap.height;
    const c = out.getContext('2d');
    c.drawImage(bitmap, 0, 0);
    if (art.naturalWidth) {
      c.globalCompositeOperation = 'multiply';
      const r = artRect(out.width, out.height);
      c.drawImage(art, r.x, r.y, r.w, r.h);
    }
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  const swatch = document.getElementById('coloring-swatch');
  const eraserBtn = document.getElementById('coloring-eraser');

  function setColor(color) {
    engine.color = color;
    engine.tool = 'brush';
    eraserBtn.classList.remove('active');
    swatch.style.background = color;
    swatch.textContent = '';
  }

  hueSlider(
    document.getElementById('coloring-hue-bar'),
    document.getElementById('coloring-hue-thumb'),
    (color) => {
      setColor(color);
      root.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    }
  );

  root.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setColor(chip.dataset.color);
      root.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  root.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      engine.size = Number(btn.dataset.size);
      root.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  eraserBtn.addEventListener('click', () => {
    const on = engine.tool !== 'eraser';
    engine.tool = on ? 'eraser' : 'brush';
    eraserBtn.classList.toggle('active', on);
    swatch.textContent = on ? '🧽' : '';
  });

  document.getElementById('coloring-undo').addEventListener('click', () => engine.undo());

  document.getElementById('coloring-prev').addEventListener('click', () => showPicture(index - 1));
  document.getElementById('coloring-next').addEventListener('click', () => showPicture(index + 1));

  holdAction(document.getElementById('coloring-clear'), 800, async () => {
    if (!engine.hasContent()) return;
    const blob = await compositeBlob();
    await saveDrawing(blob, 'coloring');
    await clearWip(wipKey());
    engine.clear();
    toast('coloring-toast');
  });

  return {
    async enter() {
      engine.resize();
      await showPicture(index, { stash: false });
    },
    async leave() {
      await stashWip();
    },
  };
}
