// Hold-to-activate: the button only triggers after being held for
// `duration` ms. Progress is exposed as the CSS variable --hold (0..1)
// so the button can render a fill animation. If `onTap` is given,
// releasing before the hold completes fires it instead.
export function holdAction(btn, duration, onComplete, onTap) {
  let timer = null;
  let raf = null;
  let t0 = 0;

  const tick = () => {
    const f = Math.min(1, (performance.now() - t0) / duration);
    btn.style.setProperty('--hold', f);
    if (f < 1) raf = requestAnimationFrame(tick);
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    cancelAnimationFrame(raf);
    btn.style.setProperty('--hold', 0);
  };

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    t0 = performance.now();
    timer = setTimeout(() => {
      cancel();
      onComplete();
    }, duration);
    tick();
  });

  btn.addEventListener('pointerup', () => {
    const wasPending = timer !== null;
    cancel();
    if (wasPending && onTap) onTap();
  });
  for (const type of ['pointercancel', 'pointerleave']) {
    btn.addEventListener(type, cancel);
  }
}

// Vertical hue slider (custom-built so it stays big and touch-friendly).
// Calls onColor with an hsl() string while dragging.
export function hueSlider(bar, thumb, onColor) {
  let dragging = false;

  function fromEvent(e) {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    thumb.style.top = `calc(${f * 100}% - 8px)`;
    onColor(`hsl(${Math.round(f * 360)} 90% 45%)`);
  }

  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    fromEvent(e);
  });
  bar.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  for (const type of ['pointerup', 'pointercancel']) {
    bar.addEventListener(type, () => { dragging = false; });
  }
}

// Quick full-screen star pop as "your drawing was saved" feedback.
export function toast(id) {
  const el = document.getElementById(id);
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
}
