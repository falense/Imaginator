// Shared drawing engine: one canvas, pointer events with pressure and
// coalesced samples, stroke-based model so undo/redo/redraw/restore all
// replay the same data.
//
// Tools: 'brush' | 'rainbow' | 'spray' | 'stamp' | 'shape' | 'eraser'.
// Mirror mode (1, 2 or 4) replays every stroke reflected around the
// canvas center axes. Spray records its actual dots and rainbow derives
// hue from the point index, so replay is always identical.

// Shape paths trace around the origin in local coordinates, unrotated,
// point-up (where applicable) at angle 0. _drawShape supplies the
// translate/rotate/reflect transform.
function polygon(ctx, pts, r) {
  ctx.moveTo(pts[0][0] * r, pts[0][1] * r);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * r, pts[i][1] * r);
  ctx.closePath();
}

function regular(ctx, n, r, inner = 0) {
  const steps = inner > 0 ? n * 2 : n;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const rad = inner > 0 && i % 2 === 1 ? r * inner : r;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    pts.push([Math.cos(a) * (rad / r), Math.sin(a) * (rad / r)]);
  }
  polygon(ctx, pts, r);
}

const SHAPE_PATHS = {
  circle: (ctx, r) => ctx.arc(0, 0, r, 0, Math.PI * 2),
  square: (ctx, r) => { const s = r * 0.72; ctx.rect(-s, -s, 2 * s, 2 * s); },
  triangle: (ctx, r) => regular(ctx, 3, r),
  diamond: (ctx, r) => regular(ctx, 4, r),
  pentagon: (ctx, r) => regular(ctx, 5, r),
  star: (ctx, r) => regular(ctx, 5, r, 0.45),
  heart: (ctx, r) => {
    ctx.moveTo(0, r);
    ctx.bezierCurveTo(-1.1 * r, 0.15 * r, -0.95 * r, -0.95 * r, 0, -0.35 * r);
    ctx.bezierCurveTo(0.95 * r, -0.95 * r, 1.1 * r, 0.15 * r, 0, r);
  },
  crescent: (ctx, r) => {
    // Outer left semicircle, then a shallower return arc through the same
    // tips, bulging left of the chord — leaves a crescent opening right.
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
    const cx = 0.55 * r;
    const cr = Math.hypot(cx, r);
    const a = Math.atan2(r, -cx);
    ctx.arc(cx, 0, cr, a, -a, false);
    ctx.closePath();
  },
  bolt: (ctx, r) => polygon(ctx, [
    [0.25, -1], [-0.45, 0.15], [-0.05, 0.15], [-0.25, 1], [0.45, -0.1], [0.05, -0.1],
  ], r),
  arrow: (ctx, r) => polygon(ctx, [
    [0, -1], [0.6, -0.25], [0.28, -0.25], [0.28, 0.95], [-0.28, 0.95], [-0.28, -0.25], [-0.6, -0.25],
  ], r),
};

export class DrawingEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.redoStack = [];
    this.baseImage = null; // flattened restore point (from auto-save)
    this.color = '#e53935';
    this.size = 14;
    this.tool = 'brush';
    this.stampEmoji = '⭐';
    this.shapeKind = 'circle';
    this.mirror = 1;
    this.onChange = null; // fires after each finished stroke / undo / redo

    this._activeId = null;
    this._activeType = null;
    this._current = null;
    this._scratch = null; // snapshot canvas for the shape drag preview

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  hasContent() {
    return this.strokes.length > 0 || this.baseImage !== null;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width === pw && this.canvas.height === ph) return;
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this._current?.tool === 'shape') {
      // The preview snapshot and center are stale in the new coordinate
      // space; drop the gesture and let redraw restore committed content.
      this._current = null;
      this._activeId = null;
      this._activeType = null;
    }
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.redoStack = [];
    this.baseImage = null;
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  undo() {
    if (this.strokes.length === 0) return;
    this.redoStack.push(this.strokes.pop());
    this.redraw();
    this.onChange?.();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const s = this.redoStack.pop();
    this.strokes.push(s);
    this._renderStroke(s);
    this.onChange?.();
  }

  redraw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, w, h);
    if (this.baseImage) this.ctx.drawImage(this.baseImage, 0, 0, w, h);
    for (const s of this.strokes) this._renderStroke(s);
  }

  // Flatten to a white-backed PNG blob (for gallery / export / auto-save).
  toBlob() {
    const out = document.createElement('canvas');
    out.width = this.canvas.width || 1;
    out.height = this.canvas.height || 1;
    const c = out.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(this.canvas, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  async restore(blob) {
    this.baseImage = await createImageBitmap(blob);
    this.strokes = [];
    this.redoStack = [];
    this.redraw();
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  _down(e) {
    if (this._activeId !== null) {
      // Palm rejection: the pen wins over an in-progress touch stroke.
      if (e.pointerType === 'pen' && this._activeType === 'touch') {
        this._current = null;
        this._activeId = null;
        this.redraw();
      } else {
        return;
      }
    }
    this._activeId = e.pointerId;
    this._activeType = e.pointerType;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const s = {
      color: this.color,
      size: this.size,
      tool: this.tool,
      mirror: this.mirror,
      points: [],
    };
    if (s.tool === 'stamp') s.emoji = this.stampEmoji;
    if (s.tool === 'shape') s.shape = this.shapeKind;
    this._current = s;

    const p = this._pos(e);
    if (s.tool === 'spray') {
      this._sprayAt(s, p);
      this._drawSpray(s, 0);
    } else if (s.tool === 'stamp') {
      s.points.push(p);
      this._drawStamp(s, p);
    } else if (s.tool === 'shape') {
      s.cx = p.x;
      s.cy = p.y;
      s.radius = this._defaultShapeRadius(s);
      s.angle = 0;
      this._takeSnapshot();
      this._drawShape(s);
    } else {
      s.points.push(p);
      this._dot(s);
    }
  }

  _move(e) {
    if (e.pointerId !== this._activeId || !this._current) return;
    const s = this._current;
    let events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (events.length === 0) events = [e]; // some inputs coalesce to nothing

    if (s.tool === 'spray') {
      const before = s.points.length;
      for (const ev of events) this._sprayAt(s, this._pos(ev));
      this._drawSpray(s, before);
    } else if (s.tool === 'stamp') {
      // Dragging drops a trail of stamps, spaced so they don't pile up.
      const gap = s.size * 3;
      for (const ev of events) {
        const p = this._pos(ev);
        const last = s.points[s.points.length - 1];
        if ((p.x - last.x) ** 2 + (p.y - last.y) ** 2 >= gap * gap) {
          s.points.push(p);
          this._drawStamp(s, p);
        }
      }
    } else if (s.tool === 'shape') {
      // Only the latest position matters: distance scales, direction rotates.
      this._updateShape(s, this._pos(e));
      this._previewShape(s);
    } else {
      const before = s.points.length;
      for (const ev of events) s.points.push(this._pos(ev));
      for (let i = Math.max(1, before); i < s.points.length; i++) this._segment(s, i);
    }
  }

  _up(e) {
    if (e.pointerId !== this._activeId) return;
    if (this._current?.tool === 'shape' && e.type === 'pointerup') {
      // pointercancel can carry junk coordinates; keep the last preview then.
      this._updateShape(this._current, this._pos(e));
      this._previewShape(this._current);
    }
    if (this._current) {
      this.strokes.push(this._current);
      this.redoStack = [];
      this._current = null;
    }
    this._activeId = null;
    this._activeType = null;
    this.onChange?.();
  }

  _renderStroke(s) {
    if (s.tool === 'shape') {
      this._drawShape(s);
    } else if (s.tool === 'stamp') {
      for (const p of s.points) this._drawStamp(s, p);
    } else if (s.tool === 'spray') {
      this._drawSpray(s, 0);
    } else {
      this._dot(s);
      for (let i = 1; i < s.points.length; i++) this._segment(s, i);
    }
  }

  // Mirror transforms for a stroke: identity, then reflections around the
  // vertical / horizontal canvas center lines.
  _transforms(s) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const list = [(p) => p];
    if (s.mirror >= 2) list.push((p) => ({ ...p, x: w - p.x }));
    if (s.mirror >= 4) {
      list.push((p) => ({ ...p, y: h - p.y }));
      list.push((p) => ({ ...p, x: w - p.x, y: h - p.y }));
    }
    return list;
  }

  _applyStyle(s, color) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalCompositeOperation =
      s.tool === 'eraser' ? 'destination-out' : 'source-over';
  }

  _segColor(s, i) {
    return s.tool === 'rainbow' ? `hsl(${(i * 7) % 360} 90% 50%)` : s.color;
  }

  _width(s, pressure) {
    return s.size * (0.4 + 1.2 * pressure);
  }

  _dot(s) {
    const p = s.points[0];
    if (!p) return;
    const ctx = this.ctx;
    ctx.save();
    this._applyStyle(s, this._segColor(s, 0));
    for (const t of this._transforms(s)) {
      const q = t(p);
      ctx.beginPath();
      ctx.arc(q.x, q.y, this._width(s, p.p) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw the smoothed segment ending at point index i: a quadratic curve
  // between midpoints, using the previous point as control point.
  _segment(s, i) {
    const pts = s.points;
    const p0 = pts[i - 2] || pts[i - 1];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const ctx = this.ctx;
    ctx.save();
    this._applyStyle(s, this._segColor(s, i));
    ctx.lineWidth = this._width(s, (p1.p + p2.p) / 2);
    for (const t of this._transforms(s)) {
      const a = t(p0);
      const b = t(p1);
      const c = t(p2);
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Spray records the dots it generates so replay matches exactly.
  _sprayAt(s, center) {
    const radius = s.size * 1.6;
    for (let k = 0; k < 6; k++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * radius;
      s.points.push({
        x: center.x + Math.cos(angle) * dist,
        y: center.y + Math.sin(angle) * dist,
        r: 0.8 + Math.random() * Math.max(1, s.size / 8),
      });
    }
  }

  _drawSpray(s, from) {
    const ctx = this.ctx;
    ctx.save();
    this._applyStyle(s, s.color);
    for (let i = from; i < s.points.length; i++) {
      const p = s.points[i];
      for (const t of this._transforms(s)) {
        const q = t(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawStamp(s, p) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${s.size * 3}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this._transforms(s)) {
      const q = t(p);
      ctx.fillText(s.emoji, q.x, q.y);
    }
    ctx.restore();
  }

  _defaultShapeRadius(s) {
    return s.size * 3;
  }

  // Shape gesture: down places the center, drag distance sets the radius
  // and drag direction the rotation. A near-tap keeps the upright default.
  _updateShape(s, p) {
    const dx = p.x - s.cx;
    const dy = p.y - s.cy;
    const d = Math.hypot(dx, dy);
    if (d < 10) {
      s.radius = this._defaultShapeRadius(s);
      s.angle = 0;
    } else {
      s.radius = d;
      s.angle = Math.atan2(dy, dx) + Math.PI / 2; // drag straight up = upright
    }
  }

  _takeSnapshot() {
    if (!this._scratch) this._scratch = document.createElement('canvas');
    this._scratch.width = this.canvas.width; // assignment also clears
    this._scratch.height = this.canvas.height;
    this._scratch.getContext('2d').drawImage(this.canvas, 0, 0);
  }

  _previewShape(s) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h); // snapshot has transparency
    ctx.drawImage(this._scratch, 0, 0, w, h);
    ctx.restore();
    this._drawShape(s);
  }

  _drawShape(s) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const r = Math.max(s.radius, 4);
    // Mirror via ctx.scale, not _transforms: point-mappers cannot reflect a
    // rotated path (crescent/bolt/arrow are not left-right symmetric).
    const copies = [[s.cx, s.cy, 1, 1]];
    if (s.mirror >= 2) copies.push([w - s.cx, s.cy, -1, 1]);
    if (s.mirror >= 4) {
      copies.push([s.cx, h - s.cy, 1, -1]);
      copies.push([w - s.cx, h - s.cy, -1, -1]);
    }
    for (const [cx, cy, sx, sy] of copies) {
      ctx.save();
      this._applyStyle(s, s.color);
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.rotate(s.angle);
      ctx.beginPath();
      SHAPE_PATHS[s.shape](ctx, r);
      ctx.fill();
      ctx.restore();
    }
  }
}
