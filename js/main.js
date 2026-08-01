import { initToddler } from './toddler.js';
import { initKids } from './kids.js';
import { initArtist } from './artist.js';
import { initGallery } from './gallery.js';
import { holdAction } from './ui.js';

const views = {
  launcher: {},
  toddler: initToddler(),
  kids: initKids(),
  artist: initArtist(),
  gallery: initGallery(),
};

let current = 'launcher';

function show(name) {
  views[current].leave?.();
  document.querySelectorAll('.view').forEach((s) => s.classList.add('hidden'));
  document.getElementById(name).classList.remove('hidden');
  current = name;
  views[name].enter?.();
}

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => show(btn.dataset.view));
});

document.getElementById('gallery-back').addEventListener('click', () => show('launcher'));

// Leaving a drawing view is adult-only: hold the home button for 1.5 s.
document.querySelectorAll('[data-home]').forEach((btn) => {
  holdAction(btn, 1500, () => show('launcher'));
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

// Hash routing (handy for testing and bookmarking a view directly).
const initial = location.hash.slice(1);
if (initial && views[initial] && initial !== 'launcher') show(initial);
