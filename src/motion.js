// Bewegung nach Castra Porto: federnd, kurz, nur beim ersten Anzeigen oder Umschalten.
// Kennt weder Daten noch Zustand der App, nur das DOM. Bei „Bewegung reduzieren“ springen Werte um,
// Seiten blenden nur kurz über.

const SPRING = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)')
  ? 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, .991, .977 51%, .974 53.8%, .975 57.1%, .997 69.8%, 1.003 76.9%, 1)'
  : 'cubic-bezier(.34, 1.56, .64, 1)';
const GLIDE = 'cubic-bezier(.32, .72, 0, 1)';
const LEAVE = 'cubic-bezier(.4, 0, 1, 1)';

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduced = () => !media || media.matches;
const play = (el, frames, opts) => (el.animate ? el.animate(frames, opts) : null);

/** Neue Ansicht: hebt sich an (Reiter) oder gleitet in Blätterrichtung herein (Monat). */
export function enter(el, dir = 'up') {
  if (!el) return;
  if (reduced()) { play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' }); return; }
  const from = dir === 'next' ? 'translateX(28px)' : dir === 'prev' ? 'translateX(-28px)' : 'translateY(12px)';
  play(el, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: dir === 'up' ? 260 : 320, easing: GLIDE });
}

/** Diagramme wachsen: Balken von links, Jahressäulen von unten, die Verlaufslinie zeichnet sich. */
export function grow(root) {
  if (!root || reduced()) return;
  const wipe = (el, delay = 0, duration = 700) => play(el, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
    { duration, delay, easing: GLIDE, fill: 'backwards' });
  root.querySelectorAll('.bar > span, .split').forEach((el) => wipe(el, 80));
  root.querySelectorAll('.share > i').forEach((el, i) => wipe(el, 120 + Math.min(i, 10) * 40, 600));
  root.querySelectorAll('.ybar .col > i').forEach((el, i) => play(el, [{ transform: 'scaleY(0)' }, { transform: 'none' }],
    { duration: 600, delay: 60 + i * 30, easing: SPRING, fill: 'backwards' }));
  root.querySelectorAll('.curve svg').forEach((el) => wipe(el, 60, 900));
  root.querySelectorAll('.curve .dot').forEach((el) => play(el, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 500, delay: 820, easing: SPRING, fill: 'backwards' }));
}

/** Zahlen zählen vom zuletzt gezeigten Wert zum neuen (beim ersten Mal von null). Schlüssel: [data-count]. */
const shown = new Map();
export function count(root, scope, format) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-count][data-cents]')) {
    const key = `${scope}:${el.dataset.count}`;
    const to = Number(el.dataset.cents);
    const from = shown.has(key) ? shown.get(key) : 0;
    shown.set(key, to);
    if (from === to || reduced() || !Number.isFinite(to)) continue;
    const ms = 700;
    const t0 = performance.now();
    const step = (t) => {
      if (!el.isConnected) return;
      const k = Math.min(1, (t - t0) / ms);
      const v = from + (to - from) * (1 - (1 - k) ** 3);
      el.innerHTML = format(k < 1 ? Math.round(v) : to, el);
      if (k < 1) requestAnimationFrame(step);
    };
    el.innerHTML = format(from, el);
    requestAnimationFrame(step);
  }
}

/** Umschalter (.seg): eine helle Pille gleitet federnd unter das gewählte Wort. */
const segAt = new Map();
function placeSeg(seg) {
  const on = seg.querySelector(':scope > button[aria-pressed="true"]');
  let pill = seg.querySelector(':scope > .seg-pill');
  if (!on || !on.offsetWidth) return;
  seg.classList.add('glide');
  if (!pill) {
    pill = document.createElement('i');
    pill.className = 'seg-pill';
    pill.setAttribute('aria-hidden', 'true');
    seg.prepend(pill);
  }
  const key = `${seg.closest('section, dialog')?.id || ''}|${seg.getAttribute('aria-label') || seg.id}`;
  const now = { x: on.offsetLeft, w: on.offsetWidth, h: on.offsetHeight, y: on.offsetTop };
  const was = segAt.get(key);
  segAt.set(key, now);
  const target = `translate(${now.x}px, ${now.y}px)`;
  const same = pill.style.transform === target && pill.style.width === `${now.w}px` && pill.style.height === `${now.h}px`;
  if (same) return;
  // Gleiten nur, wenn sich die Wahl geändert hat, nicht beim ersten Zeichnen oder bei anderer Breite derselben Wahl.
  const from = pill.style.width ? { x: parseFloat(pill.dataset.x), w: parseFloat(pill.style.width) } : was;
  pill.style.width = `${now.w}px`;
  pill.style.height = `${now.h}px`;
  pill.style.transform = target;
  pill.dataset.x = now.x;
  if (from && from.x !== now.x && !reduced()) {
    play(pill, [{ transform: `translate(${from.x}px, ${now.y}px)`, width: `${from.w}px` }, { transform: target, width: `${now.w}px` }],
      { duration: 380, easing: GLIDE }); // ohne Überschwingen, sonst ragt die Pille aus der Leiste
  }
}
let queued = false;
export function segs() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; document.querySelectorAll('.seg').forEach(placeSeg); });
}
/** Beobachtet die Seite, damit jeder Umschalter von selbst gleitet, egal wer ihn neu zeichnet. */
export function watchSegs() {
  new MutationObserver(segs).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'open', 'hidden'] });
  addEventListener('resize', () => { for (const p of document.querySelectorAll('.seg-pill')) p.style.width = ''; segs(); });
  segs();
}

/** Punkt in der unteren Leiste gleitet vom alten zum neuen Reiter. */
export function tabDot(fromA, toA) {
  const a = fromA?.querySelector('.tdot');
  const b = toA?.querySelector('.tdot');
  if (!a || !b || a === b || reduced()) return;
  const dx = a.getBoundingClientRect().left - b.getBoundingClientRect().left;
  if (dx) play(b, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 550, easing: SPRING });
}

/** Sheet gleitet hinaus, danach erst schließen. Startet dort, wo das Wischen den Finger losgelassen hat. */
export function closeSheet(d, done) {
  if (d.classList.contains('closing')) return;
  const from = d.style.transform || 'none';
  d.classList.add('closing');
  const frames = reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: from }, { transform: 'translateY(100%)' }];
  const a = play(d, frames, { duration: reduced() ? 120 : 220, easing: LEAVE, fill: 'forwards' });
  const end = () => { d.classList.remove('closing'); d.style.transform = ''; done(); a?.cancel(); };
  if (a) a.onfinish = end; else end();
}

/** Halb gewischtes Sheet federt zurück. */
export function springBack(d) {
  const from = d.style.transform;
  d.style.transform = '';
  if (from && !reduced()) play(d, [{ transform: from }, { transform: 'none' }], { duration: 450, easing: SPRING });
}

/** Einordnen: die nächste Zahlung gleitet herein (zurück: von links). */
export function slideIn(el, back = false) {
  if (!el || reduced()) return;
  play(el, [{ opacity: 0, transform: `translateX(${back ? -32 : 32}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, easing: GLIDE });
}

/** Kurz hervorheben, was gerade ankam: der Goldtaler dreht sich einmal, ein Element ploppt auf. */
export function spin(el) {
  if (!el || reduced()) return;
  play(el, [{ transform: 'translateY(.22em) rotateY(0)' }, { transform: 'translateY(.22em) rotateY(360deg)' }], { duration: 900, easing: SPRING });
}
export function pop(el, delay = 0) {
  if (!el || reduced()) return;
  play(el, [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, delay, easing: SPRING, fill: 'backwards' });
}
