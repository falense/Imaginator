// Shared drawing engine: one canvas, pointer events with pressure and
// coalesced samples, stroke-based model so undo/redraw/restore all replay
// the same data.

export class DrawingEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.baseImage = null; // flattened restore point (from auto-save)
    this.color = '#e53935';
    this.size = 14;
    this.tool = 'brush'; // 'brush' | 'eraser'
    this.onChange = null; // fires after each finished stroke / undo

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
    this.baseImage = null;
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  undo() {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this.redraw();
    this.onChange?.();
  }

  redraw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, w, h);
    if (this.baseImage) this.ctx.drawImage(this.baseImage, 0, 0, w, h);
    for (const s of this.strokes) {
      this._dot(s);
      for (let i = 1; i < s.points.length; i++) this._segment(s, i);
    }
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
    this._current = {
      color: this.color,
      size: this.size,
      tool: this.tool,
      points: [this._pos(e)],
    };
    this._dot(this._current);
  }

  _move(e) {
    if (e.pointerId !== this._activeId || !this._current) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const pts = this._current.points;
    const before = pts.length;
    for (const ev of events) pts.push(this._pos(ev));
    for (let i = Math.max(1, before); i < pts.length; i++) {
      this._segment(this._current, i);
    }
  }

  _up(e) {
    if (e.pointerId !== this._activeId) return;
    if (this._current) {
      this.strokes.push(this._current);
      this._current = null;
    }
    this._activeId = null;
    this._activeType = null;
    this.onChange?.();
  }

  _applyStyle(stroke) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.globalCompositeOperation =
      stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  }

  _width(stroke, pressure) {
    return stroke.size * (0.4 + 1.2 * pressure);
  }

  _dot(stroke) {
    const p = stroke.points[0];
    const ctx = this.ctx;
    ctx.save();
    this._applyStyle(stroke);
    ctx.beginPath();
    ctx.arc(p.x, p.y, this._width(stroke, p.p) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw the smoothed segment ending at point index i: a quadratic curve
  // between midpoints, using the previous point as control point.
  _segment(stroke, i) {
    const pts = stroke.points;
    const p0 = pts[i - 2] || pts[i - 1];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const ctx = this.ctx;
    ctx.save();
    this._applyStyle(stroke);
    ctx.lineWidth = this._width(stroke, (p1.p + p2.p) / 2);
    ctx.beginPath();
    ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    ctx.stroke();
    ctx.restore();
  }
}
