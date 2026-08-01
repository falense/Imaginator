// Artist view (tier 3): everything from the kids view plus rainbow brush,
// spray can, emoji stamps, mirror mode, redo, and a two-axis color picker
// (hue + light/dark) for "any color I want".

import { DrawingEngine } from './engine.js';
import { saveDrawing, saveWip, getWip, clearWip } from './db.js';
import { holdAction, toast } from './ui.js';

const STAMPS = [
  '🦄', '🌈', '⭐', '❤️', '🐱', '🐶', '🦋', '🌸', '🌞', '🌙',
  '🚀', '🐟', '🐸', '🍎', '🎈', '👑', '⚽', '🍦', '🐢', '🔥',
];

const MIRROR_STATES = [1, 2, 4];

export function initArtist() {
  const engine = new DrawingEngine(document.getElementById('artist-canvas'));
  const root = document.getElementById('artist');
  let hue = 0;
  let light = 45;

  let wipTimer = null;
  engine.onChange = () => {
    clearTimeout(wipTimer);
    wipTimer = setTimeout(async () => {
      if (engine.hasContent()) saveWip('artist', await engine.toBlob());
      else clearWip('artist');
    }, 800);
  };

  const swatch = document.getElementById('artist-swatch');
  const stampPanel = document.getElementById('stamp-panel');
  const mirrorBadge = document.getElementById('a-mirror-badge');
  const lightBar = document.getElementById('artist-light');

  const toolBtns = {
    brush: document.getElementById('a-brush'),
    rainbow: document.getElementById('a-rainbow'),
    spray: document.getElementById('a-spray'),
    stamp: document.getElementById('a-stamp'),
    eraser: document.getElementById('a-eraser'),
  };

  function updateSwatch() {
    swatch.textContent = '';
    if (engine.tool === 'eraser') {
      swatch.style.background = '#ffffff';
      swatch.textContent = '🧽';
    } else if (engine.tool === 'stamp') {
      swatch.style.background = '#ffffff';
      swatch.textContent = engine.stampEmoji;
    } else if (engine.tool === 'rainbow') {
      swatch.style.background =
        'linear-gradient(45deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f)';
    } else {
      swatch.style.background = engine.color;
    }
  }

  function applyColor() {
    engine.color = `hsl(${hue} 90% ${light}%)`;
    lightBar.style.background =
      `linear-gradient(to bottom, #fff, hsl(${hue} 90% 50%), #000)`;
    // Picking a color implies wanting to paint with it.
    if (engine.tool === 'eraser' || engine.tool === 'stamp') setTool('brush');
    else updateSwatch();
  }

  function setTool(name) {
    engine.tool = name;
    for (const [key, btn] of Object.entries(toolBtns)) {
      btn.classList.toggle('active', key === name);
    }
    stampPanel.classList.toggle('hidden', name !== 'stamp');
    updateSwatch();
  }

  for (const [key, btn] of Object.entries(toolBtns)) {
    btn.addEventListener('click', () => setTool(key));
  }

  // Vertical drag bars for hue and lightness.
  function vbar(bar, thumb, onFrac) {
    let dragging = false;
    const set = (e) => {
      const r = bar.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      thumb.style.top = `calc(${f * 100}% - 8px)`;
      onFrac(f);
    };
    bar.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      set(e);
    });
    bar.addEventListener('pointermove', (e) => { if (dragging) set(e); });
    for (const type of ['pointerup', 'pointercancel']) {
      bar.addEventListener(type, () => { dragging = false; });
    }
  }

  vbar(document.getElementById('artist-hue'), document.getElementById('artist-hue-thumb'), (f) => {
    hue = Math.round(f * 360);
    applyColor();
  });
  vbar(lightBar, document.getElementById('artist-light-thumb'), (f) => {
    light = Math.round(97 - f * 94); // near-white .. near-black
    applyColor();
  });

  // Stamp picker.
  STAMPS.forEach((emoji, i) => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => {
      engine.stampEmoji = emoji;
      stampPanel.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateSwatch();
    });
    stampPanel.appendChild(btn);
  });
  engine.stampEmoji = STAMPS[0];

  // Mirror mode cycles off -> 2 -> 4.
  const mirrorBtn = document.getElementById('a-mirror');
  mirrorBtn.addEventListener('click', () => {
    const next = MIRROR_STATES[(MIRROR_STATES.indexOf(engine.mirror) + 1) % MIRROR_STATES.length];
    engine.mirror = next;
    mirrorBadge.textContent = next > 1 ? `×${next}` : '';
    mirrorBtn.classList.toggle('active', next > 1);
  });

  root.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      engine.size = Number(btn.dataset.size);
      root.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('a-undo').addEventListener('click', () => engine.undo());
  document.getElementById('a-redo').addEventListener('click', () => engine.redo());

  holdAction(document.getElementById('a-clear'), 800, async () => {
    if (!engine.hasContent()) return;
    const blob = await engine.toBlob();
    await saveDrawing(blob, 'artist');
    await clearWip('artist');
    engine.clear();
    toast('artist-toast');
  });

  applyColor();

  return {
    async enter() {
      engine.resize();
      const wip = await getWip('artist');
      if (wip) await engine.restore(wip);
    },
    async leave() {
      clearTimeout(wipTimer);
      if (engine.hasContent()) await saveWip('artist', await engine.toBlob());
    },
  };
}
