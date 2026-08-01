// Hold-to-activate: the button only triggers after being held for
// `duration` ms. Progress is exposed as the CSS variable --hold (0..1)
// so the button can render a fill animation.
export function holdAction(btn, duration, onComplete) {
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

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    btn.addEventListener(type, cancel);
  }
}

// Quick full-screen star pop as "your drawing was saved" feedback.
export function toast(id) {
  const el = document.getElementById(id);
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
}
