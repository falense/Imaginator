// Physics view: a sandspiel-style falling-sand toy. The world is a coarse
// grid of element cells simulated in place and rendered into a tiny canvas
// that CSS upscales with pixelated rendering. A corner arrow rotates
// gravity 90° per tap, and the whole grid persists via the wip store.

import { saveDrawing, saveWip, getWip, clearWip } from './db.js';
import { holdAction, toast } from './ui.js';

const CELL = 4; // CSS px per grid cell
const STEP = 1000 / 60; // fixed simulation timestep (ms)

const EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, FIRE = 4, PLANT = 5, SMOKE = 6;

// '#rrggbb' -> ABGR uint32 (the little-endian RGBA byte order of ImageData).
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return (0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0;
};

// Four shades per element; each grain keeps a random shade for texture.
const PALETTE = new Uint32Array([
  '#ffffff', '#ffffff', '#ffffff', '#ffffff', // empty
  '#6f6f6f', '#7d7d7d', '#8a8a8a', '#989898', // wall
  '#c9a03d', '#d9b04a', '#e6c25a', '#f0d070', // sand
  '#2f86c4', '#3d92d0', '#4aa3e0', '#63b5ee', // water
  '#000000', '#000000', '#000000', '#000000', // fire (colored by lifetime)
  '#2e7d32', '#3d9c43', '#4caf50', '#66bb6a', // plant
  '#b8b8b8', '#c4c4c4', '#cfcfcf', '#dadada', // smoke
].map(hex));
const FIRE_COLORS = ['#f4511e', '#ff9800', '#ffd54f'].map(hex);
const fireLife = () => 24 + ((Math.random() * 24) | 0);
const shade = () => (Math.random() * 4) | 0;

// Gravity directions: 0 down, 1 left, 2 up, 3 right (one tap = 90° turn).
const GX = [0, -1, 0, 1];
const GY = [1, 0, -1, 0];

export function initPhysics() {
  const root = document.getElementById('physics');
  const canvas = document.getElementById('physics-canvas');
  const ctx = canvas.getContext('2d');
  const gravityBtn = document.getElementById('physics-gravity');
  const pauseBtn = document.getElementById('physics-pause');

  let cols = 0, rows = 0;
  let cells = new Uint8Array(0); // element id per cell
  let data = new Uint8Array(0); // bits 0-1 shade, bit 2 water bias; fire: lifetime
  let moved = new Uint8Array(0); // "acted this tick" flag
  let img = null, pix = null;

  let element = SAND;
  let radius = 4;
  let gravity = 0;
  let spin = 0; // cumulative arrow rotation so it always spins the same way
  let paused = false;
  const pointer = { down: false, id: -1, cx: 0, cy: 0, px: 0, py: 0 };

  let rafId = null, lastT = 0, acc = 0, frame = 0;
  let active = false, dirty = false, lastSave = 0;

  const inBounds = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
  const idx = (x, y) => (inBounds(x, y) ? y * cols + x : -1);
  const hasContent = () => cells.some((c) => c !== EMPTY);
  const nbuf = new Int32Array(4); // scratch for 4-neighborhood checks

  function swap(i, j) {
    const c = cells[i]; cells[i] = cells[j]; cells[j] = c;
    const d = data[i]; data[i] = data[j]; data[j] = d;
    moved[i] = moved[j] = 1;
  }

  // Slide a water grain up to 6 cells along the sideways axis, stopping
  // early at an edge it can fall over. Returns the target index or -1.
  function slide(x, y, dir, gx, gy, pxv, pyv) {
    let tx = x, ty = y, j = -1;
    for (let k = 0; k < 6; k++) {
      tx += dir * pxv;
      ty += dir * pyv;
      const t = idx(tx, ty);
      if (t === -1 || cells[t] !== EMPTY) break;
      j = t;
      const bt = idx(tx + gx, ty + gy);
      if (bt !== -1 && cells[bt] === EMPTY) break;
    }
    return j;
  }

  // ---------- Grid sizing / persistence helpers ----------

  // Copy another grid into ours anchored top-left (resize keeps the world).
  function copyInto(srcCells, srcData, sc, sr) {
    const w = Math.min(sc, cols), h = Math.min(sr, rows);
    for (let y = 0; y < h; y++) {
      cells.set(srcCells.subarray(y * sc, y * sc + w), y * cols);
      data.set(srcData.subarray(y * sc, y * sc + w), y * cols);
    }
  }

  function resizeGrid() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // hidden view reports 0×0
    const nc = Math.max(4, (w / CELL) | 0);
    const nr = Math.max(4, (h / CELL) | 0);
    if (nc === cols && nr === rows) return;
    const oldCells = cells, oldData = data, oc = cols, or_ = rows;
    cols = nc; rows = nr;
    cells = new Uint8Array(cols * rows);
    data = new Uint8Array(cols * rows);
    moved = new Uint8Array(cols * rows);
    copyInto(oldCells, oldData, oc, or_);
    canvas.width = cols;
    canvas.height = rows;
    img = ctx.createImageData(cols, rows);
    pix = new Uint32Array(img.data.buffer);
    render();
  }

  // Snapshot arrays before the async IndexedDB write clones them.
  const wipState = () => ({ cols, rows, gravity, cells: cells.slice(), data: data.slice() });

  // ---------- Simulation ----------

  function tick() {
    frame++;
    moved.fill(0);
    const gx = GX[gravity], gy = GY[gravity]; // "down" for this world
    const pxv = -gy, pyv = gx; // one perpendicular ("sideways") unit vector
    const vertical = gy !== 0;
    const aMax = vertical ? rows : cols; // gravity-axis length
    const bMax = vertical ? cols : rows;
    const aFwd = (vertical ? gy : gx) > 0; // gravity points toward high indices?

    for (let ai = 0; ai < aMax; ai++) {
      const a = aFwd ? aMax - 1 - ai : ai; // scan from the far wall backwards
      const bRev = (ai + frame) & 1; // alternate sweep to avoid lateral bias
      for (let bi = 0; bi < bMax; bi++) {
        const b = bRev ? bMax - 1 - bi : bi;
        const x = vertical ? b : a;
        const y = vertical ? a : b;
        const i = y * cols + x;
        const el = cells[i];
        if (el === EMPTY || el === WALL || moved[i]) continue;

        if (el === SAND) {
          const d = idx(x + gx, y + gy);
          if (d !== -1 && (cells[d] === EMPTY || cells[d] === SMOKE)) { swap(i, d); continue; }
          if (d !== -1 && cells[d] === WATER && Math.random() < 0.6) { swap(i, d); continue; }
          const s = Math.random() < 0.5 ? 1 : -1;
          const d1 = idx(x + gx + s * pxv, y + gy + s * pyv);
          const d2 = idx(x + gx - s * pxv, y + gy - s * pyv);
          if (d1 !== -1 && (cells[d1] === EMPTY || cells[d1] === WATER)) swap(i, d1);
          else if (d2 !== -1 && (cells[d2] === EMPTY || cells[d2] === WATER)) swap(i, d2);
          continue;
        }

        if (el === WATER) {
          const d = idx(x + gx, y + gy);
          if (d !== -1 && (cells[d] === EMPTY || cells[d] === SMOKE)) { swap(i, d); continue; }
          const s = Math.random() < 0.5 ? 1 : -1;
          const d1 = idx(x + gx + s * pxv, y + gy + s * pyv);
          const d2 = idx(x + gx - s * pxv, y + gy - s * pyv);
          if (d1 !== -1 && cells[d1] === EMPTY) { swap(i, d1); continue; }
          if (d2 !== -1 && cells[d2] === EMPTY) { swap(i, d2); continue; }
          // Flow sideways: prefer the committed direction, else the other.
          // Dispersing several cells per tick levels pools and closes the
          // one-cell gaps that otherwise freeze into comb/string artifacts.
          const bDir = data[i] & 4 ? 1 : -1;
          let j = slide(x, y, bDir, gx, gy, pxv, pyv);
          if (j === -1) {
            j = slide(x, y, -bDir, gx, gy, pxv, pyv);
            if (j !== -1) data[i] ^= 4; // committed direction is dry: turn around
          }
          if (j !== -1) swap(i, j);
          continue;
        }

        nbuf[0] = x > 0 ? i - 1 : -1;
        nbuf[1] = x < cols - 1 ? i + 1 : -1;
        nbuf[2] = y > 0 ? i - cols : -1;
        nbuf[3] = y < rows - 1 ? i + cols : -1;

        if (el === FIRE) {
          let steamed = false;
          for (let k = 0; k < 4; k++) {
            const n = nbuf[k];
            if (n !== -1 && cells[n] === WATER) {
              cells[i] = SMOKE; data[i] = shade(); moved[i] = 1;
              if (Math.random() < 0.3) { cells[n] = SMOKE; data[n] = shade(); moved[n] = 1; }
              steamed = true;
              break;
            }
          }
          if (steamed) continue;
          for (let k = 0; k < 4; k++) {
            const n = nbuf[k];
            if (n !== -1 && cells[n] === PLANT && Math.random() < 0.35) {
              cells[n] = FIRE; data[n] = fireLife(); moved[n] = 1;
            }
          }
          if (--data[i] === 0) {
            cells[i] = Math.random() < 0.5 ? SMOKE : EMPTY;
            data[i] = shade();
          } else if (Math.random() < 0.25) {
            const u = idx(x - gx, y - gy);
            if (u !== -1 && cells[u] === EMPTY) swap(i, u); // flame lick
          }
          continue;
        }

        if (el === PLANT) {
          // Drink neighboring water and sprout a new shoot away from
          // gravity, so watered plants branch up and outwards. Shoots may
          // grow through water too — stems climb up out of ponds.
          for (let k = 0; k < 4; k++) {
            const n = nbuf[k];
            if (n !== -1 && cells[n] === WATER && Math.random() < 0.12) {
              cells[n] = EMPTY; data[n] = 0; moved[n] = 1;
              const grow = (tx, ty) => {
                const t = idx(tx, ty);
                if (t === -1 || (cells[t] !== EMPTY && cells[t] !== WATER)) return false;
                cells[t] = PLANT; data[t] = shade(); moved[t] = 1;
                return true;
              };
              const s = Math.random() < 0.5 ? 1 : -1;
              grow(x - gx, y - gy) || // straight up first,
                grow(x - gx + s * pxv, y - gy + s * pyv) || // then the diagonals,
                grow(x - gx - s * pxv, y - gy - s * pyv) ||
                grow(x + s * pxv, y + s * pyv); // then sideways
            }
          }
          continue;
        }

        if (el === SMOKE) {
          if (Math.random() < 0.015) { cells[i] = EMPTY; data[i] = 0; continue; }
          const u = idx(x - gx, y - gy);
          if (u !== -1 && cells[u] === EMPTY && Math.random() < 0.8) { swap(i, u); continue; }
          const s = Math.random() < 0.5 ? 1 : -1;
          const u1 = idx(x - gx + s * pxv, y - gy + s * pyv);
          const u2 = idx(x - gx - s * pxv, y - gy - s * pyv);
          if (u1 !== -1 && cells[u1] === EMPTY) swap(i, u1);
          else if (u2 !== -1 && cells[u2] === EMPTY) swap(i, u2);
          else if (Math.random() < 0.3) {
            const sd = idx(x + s * pxv, y + s * pyv);
            if (sd !== -1 && cells[sd] === EMPTY) swap(i, sd);
          }
        }
      }
    }
  }

  function render() {
    if (!img) return;
    for (let i = 0; i < cells.length; i++) {
      const el = cells[i];
      if (el === FIRE) {
        const f = data[i] > 32 ? 2 : data[i] > 16 ? 1 : 0;
        pix[i] = FIRE_COLORS[Math.random() < 0.3 ? Math.min(2, f + 1) : f]; // flicker
      } else {
        pix[i] = PALETTE[(el << 2) | (data[i] & 3)];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- Painting ----------

  function stampCircle(cx, cy) {
    const r = radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = (cx + dx) | 0, y = (cy + dy) | 0;
        if (!inBounds(x, y)) continue;
        const i = y * cols + x;
        cells[i] = element;
        // Bit 2 randomizes water's initial flow direction so a fresh pour
        // doesn't drift one way in lockstep.
        data[i] = element === FIRE ? fireLife() : shade() | (Math.random() < 0.5 ? 4 : 0);
        moved[i] = 1;
      }
    }
  }

  // Runs once per simulation step: stamp along the segment since the last
  // step so fast scribbles leave no gaps, and a held finger keeps pouring.
  function paint() {
    if (!pointer.down) return;
    const dx = pointer.cx - pointer.px, dy = pointer.cy - pointer.py;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, radius)));
    for (let s = 1; s <= steps; s++) {
      stampCircle(pointer.px + (dx * s) / steps, pointer.py + (dy * s) / steps);
    }
    pointer.px = pointer.cx;
    pointer.py = pointer.cy;
    dirty = true;
  }

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.cx = ((e.clientX - r.left) / r.width) * cols;
    pointer.cy = ((e.clientY - r.top) / r.height) * rows;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (pointer.down) return; // one pointer at a time
    pointer.down = true;
    pointer.id = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setPointer(e);
    pointer.px = pointer.cx;
    pointer.py = pointer.cy;
    stampCircle(pointer.cx, pointer.cy); // instant feedback on tap
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointer.down && e.pointerId === pointer.id) setPointer(e);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerId === pointer.id) pointer.down = false;
    });
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Frame loop ----------

  function loop(t) {
    rafId = requestAnimationFrame(loop);
    acc += Math.min(100, t - lastT);
    lastT = t;
    let n = 0;
    while (acc >= STEP && n < 3) {
      paint();
      if (!paused) tick();
      acc -= STEP;
      n++;
    }
    if (n === 3) acc = 0; // never fast-forward after a stall
    render();
    if (dirty && t - lastSave > 4000) {
      lastSave = t;
      dirty = false;
      saveWip('physics', wipState());
    }
  }

  function start() {
    if (rafId !== null) return;
    lastT = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) stop();
    else start();
  });

  new ResizeObserver(() => resizeGrid()).observe(canvas);

  // ---------- Rail + gravity controls ----------

  root.querySelectorAll('[data-element]').forEach((btn) => {
    btn.addEventListener('click', () => {
      element = Number(btn.dataset.element);
      root.querySelectorAll('[data-element]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  root.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      radius = Number(btn.dataset.radius);
      root.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  gravityBtn.addEventListener('click', () => {
    gravity = (gravity + 1) & 3;
    spin += 90;
    gravityBtn.style.transform = `rotate(${spin}deg)`;
    dirty = true;
  });

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶' : '⏸';
    pauseBtn.classList.toggle('active', paused);
  });

  async function exportBlob() {
    const out = document.createElement('canvas');
    out.width = cols * CELL;
    out.height = rows * CELL;
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(canvas, 0, 0, out.width, out.height);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  document.getElementById('physics-snap').addEventListener('click', async () => {
    if (!hasContent()) return;
    render();
    await saveDrawing(await exportBlob(), 'physics');
    toast('physics-toast');
  });

  holdAction(document.getElementById('physics-clear'), 800, async () => {
    if (!hasContent()) return;
    render();
    await saveDrawing(await exportBlob(), 'physics'); // never lose anything
    cells.fill(EMPTY);
    data.fill(0);
    dirty = false;
    await clearWip('physics');
    toast('physics-toast');
  });

  return {
    async enter() {
      active = true;
      resizeGrid(); // section is visible now, so dimensions are real
      const wip = await getWip('physics');
      if (wip && wip.cells) {
        copyInto(wip.cells, wip.data, wip.cols, wip.rows);
        gravity = (wip.gravity ?? 0) & 3;
        spin = gravity * 90;
        gravityBtn.style.transform = `rotate(${spin}deg)`;
      }
      if (active) start(); // user may have left during the await
    },
    leave() {
      stop(); // synchronously first: show() doesn't await leave()
      active = false;
      pointer.down = false;
      if (hasContent()) saveWip('physics', wipState());
      else clearWip('physics');
    },
  };
}
