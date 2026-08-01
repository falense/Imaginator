// Shared drawing engine: one canvas, pointer events with pressure and
// coalesced samples, stroke-based model so undo/redo/redraw/restore all
// replay the same data.
//
// Tools: 'brush' | 'rainbow' | 'spray' | 'stamp' | 'eraser'.
// Mirror mode (1, 2 or 4) replays every stroke reflected around the
// canvas center axes. Spray records its actual dots and rainbow derives
// hue from the point index, so replay is always identical.

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
    this.mirror = 1;
    this.onChange = null; // fires after each finished stroke / undo / redo

    this._activeId = null;
    this._activeType = null;
    this._current = null;

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
    this._current = s;

    const p = this._pos(e);
    if (s.tool === 'spray') {
      this._sprayAt(s, p);
      this._drawSpray(s, 0);
    } else if (s.tool === 'stamp') {
      s.points.push(p);
      this._drawStamp(s, p);
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
    } else {
      const before = s.points.length;
      for (const ev of events) s.points.push(this._pos(ev));
      for (let i = Math.max(1, before); i < s.points.length; i++) this._segment(s, i);
    }
  }

  _up(e) {
    if (e.pointerId !== this._activeId) return;
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
    if (s.tool === 'stamp') {
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
}
