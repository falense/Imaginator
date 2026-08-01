// Kids (4–6) view: full hue slider for infinite colors, plus black/white/
// brown chips, brush sizes, eraser, undo, and a deliberate hold-to-clear
// button that saves to the gallery before clearing.

import { DrawingEngine } from './engine.js';
import { saveDrawing, saveWip, getWip, clearWip } from './db.js';
import { holdAction, toast } from './ui.js';

export function initKids() {
  const engine = new DrawingEngine(document.getElementById('kids-canvas'));
  engine.color = 'hsl(0 90% 45%)';

  let wipTimer = null;
  const scheduleWipSave = () => {
    clearTimeout(wipTimer);
    wipTimer = setTimeout(async () => {
      if (engine.hasContent()) saveWip('kids', await engine.toBlob());
    }, 800);
  };
  engine.onChange = scheduleWipSave;

  const swatch = document.getElementById('kids-swatch');
  const eraserBtn = document.getElementById('eraser-btn');

  function setColor(color) {
    engine.color = color;
    engine.tool = 'brush';
    eraserBtn.classList.remove('active');
    swatch.style.background = color;
    swatch.textContent = '';
  }

  // Hue slider (custom-built so it stays big and touch-friendly).
  const bar = document.getElementById('hue-bar');
  const thumb = document.getElementById('hue-thumb');
  let draggingHue = false;

  function hueFromEvent(e) {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    thumb.style.top = `calc(${f * 100}% - 8px)`;
    setColor(`hsl(${Math.round(f * 360)} 90% 45%)`);
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  }

  bar.addEventListener('pointerdown', (e) => {
    draggingHue = true;
    try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    hueFromEvent(e);
  });
  bar.addEventListener('pointermove', (e) => { if (draggingHue) hueFromEvent(e); });
  for (const type of ['pointerup', 'pointercancel']) {
    bar.addEventListener(type, () => { draggingHue = false; });
  }

  // Black / white / brown chips.
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setColor(chip.dataset.color);
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // Brush sizes.
  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      engine.size = Number(btn.dataset.size);
      document.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  eraserBtn.addEventListener('click', () => {
    const on = engine.tool !== 'eraser';
    engine.tool = on ? 'eraser' : 'brush';
    eraserBtn.classList.toggle('active', on);
    swatch.textContent = on ? '🧽' : '';
  });

  document.getElementById('undo-btn').addEventListener('click', () => engine.undo());

  holdAction(document.getElementById('clear-btn'), 800, async () => {
    if (!engine.hasContent()) return;
    const blob = await engine.toBlob();
    await saveDrawing(blob, 'kids');
    await clearWip('kids');
    engine.clear();
    toast('kids-toast');
  });

  return {
    async enter() {
      engine.resize();
      const wip = await getWip('kids');
      if (wip) await engine.restore(wip);
    },
    async leave() {
      clearTimeout(wipTimer);
      if (engine.hasContent()) await saveWip('kids', await engine.toBlob());
    },
  };
}
