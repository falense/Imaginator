// Toddler view: pick a color, draw. Picking a *different* color saves the
// current drawing to the gallery, clears the canvas, and switches color —
// one drawing per color session, and nothing is ever lost.

import { DrawingEngine } from './engine.js';
import { saveDrawing, saveWip, getWip, clearWip } from './db.js';
import { toast } from './ui.js';

const COLORS = [
  '#e53935', // red
  '#fb8c00', // orange
  '#fdd835', // yellow
  '#43a047', // green
  '#1e88e5', // blue
  '#8e24aa', // purple
  '#f06292', // pink
  '#5d4037', // brown
];

export function initToddler() {
  const engine = new DrawingEngine(document.getElementById('toddler-canvas'));
  engine.size = 20;
  engine.color = COLORS[0];

  let wipTimer = null;
  engine.onChange = () => {
    clearTimeout(wipTimer);
    wipTimer = setTimeout(async () => {
      if (engine.hasContent()) saveWip('toddler', await engine.toBlob());
    }, 800);
  };

  const rail = document.getElementById('toddler-colors');
  COLORS.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'color-dot' + (i === 0 ? ' active' : '');
    btn.style.background = color;
    btn.addEventListener('click', () => pick(btn, color));
    rail.appendChild(btn);
  });

  async function pick(btn, color) {
    if (color === engine.color) return;
    if (engine.hasContent()) {
      const blob = await engine.toBlob();
      await saveDrawing(blob, 'toddler');
      await clearWip('toddler');
      engine.clear();
      toast('toddler-toast');
    }
    engine.color = color;
    rail.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
    btn.classList.add('active');
  }

  return {
    async enter() {
      engine.resize();
      const wip = await getWip('toddler');
      if (wip) await engine.restore(wip);
    },
    async leave() {
      clearTimeout(wipTimer);
      if (engine.hasContent()) await saveWip('toddler', await engine.toBlob());
    },
  };
}
