// Kids (4–6) view: full hue slider for infinite colors, plus black/white/
// brown chips, brush sizes, eraser, undo, and a deliberate hold-to-clear
// button that saves to the gallery before clearing.

import { DrawingEngine } from './engine.js';
import { saveDrawing, saveWip, getWip, clearWip } from './db.js';
import { holdAction, toast, hueSlider } from './ui.js';

export function initKids() {
  const engine = new DrawingEngine(document.getElementById('kids-canvas'));
  const root = document.getElementById('kids');
  engine.color = 'hsl(0 90% 45%)';

  let wipTimer = null;
  const scheduleWipSave = () => {
    clearTimeout(wipTimer);
    wipTimer = setTimeout(async () => {
      if (engine.hasContent()) saveWip('kids', await engine.toBlob());
      else clearWip('kids');
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

  hueSlider(
    document.getElementById('hue-bar'),
    document.getElementById('hue-thumb'),
    (color) => {
      setColor(color);
      root.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    }
  );

  // Black / white / brown chips.
  root.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setColor(chip.dataset.color);
      root.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // Brush sizes.
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
