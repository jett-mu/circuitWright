import { Circuit, DEFS, GROUPS, defaultState, dims, pinPos } from './model.js';
import { simulate } from './sim.js';
import { el, renderCircuit, drawComponent, SVG_CSS } from './render.js';
import { autosave, restore, saveFile, loadFile } from './storage.js';
import { DEFAULT_EXPORT, buildSchematic, circuitSchematic, exportCircuitPNG, exportCircuitSVG, exportPNG, exportSVG } from './export.js';
import { EXAMPLES } from './examples.js';
import { requireDisclaimer } from './disclaimer.js';

const $ = (s) => document.querySelector(s);
const svg = $('#ws'), world = $('#world'), grid = $('#grid'), hint = $('#hint');
const circ = new Circuit();
let out = {};
let view = { x: 40, y: 60, k: 1 };
let sel = null;   // {kind:'c'|'w', id}
let drag = null;
const multi = { c: new Set(), w: new Set() }; // marquee (right-drag) selection

const snap = (v) => Math.round(v / 10) * 10;
const toWorld = (e) => {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
};

// ---- drawing ------------------------------------------------------------
function tempWire() {
  if (drag?.type !== 'wire') return null;
  const at = (e, side) => (e.c === undefined ? e : pinPos(circ.get(e.c), side, e.p));
  if (drag.side === 'out') {
    return { a: at(drag.from, 'out'), b: drag.pos, on: drag.from.c !== undefined && out[`${drag.from.c}:${drag.from.p}`] };
  }
  return { a: drag.pos, b: at(drag.to, 'in'), on: false };
}

function draw() {
  world.replaceChildren();
  renderCircuit(world, circ, out, { interactive: true, selected: sel, multi, temp: tempWire(), hoverWire });
  if (drag?.type === 'marquee') {
    const r = marqueeRect(drag);
    world.append(el('rect', { class: 'marquee', x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 }));
  }
  world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const s = 20 * view.k;
  grid.setAttribute('width', s); grid.setAttribute('height', s);
  grid.setAttribute('patternTransform', `translate(${view.x},${view.y})`);
  hint.hidden = circ.components.length > 0;
  updateInspector();
}

// Undo/redo: snapshots of the circuit, recorded whenever its structure
// (parts, positions, wires) changes. Switch/key states don't create entries.
const hist = [];
let hi = -1;
const structKey = () => JSON.stringify([circ.components.map((c) => [c.id, c.type, c.x, c.y, c.state.bits, c.state.base, c.state.min, c.state.max, c.state.hz]), circ.wires]);

function record() {
  const key = structKey();
  if (hist[hi]?.key === key) return;
  hist.length = hi + 1;
  hist.push({ key, json: JSON.stringify(circ.toJSON()) });
  if (hist.length > 100) hist.shift();
  hi = hist.length - 1;
}

function stepHistory(dir) {
  const n = hi + dir;
  if (n < 0 || n >= hist.length) return;
  hi = n;
  const states = new Map(circ.components.map((c) => [c.id, [c.type, c.state]]));
  circ.load(JSON.parse(hist[hi].json));
  const live = ['on', 'down', 'value', 'running']; // runtime state survives undo; settings come from the snapshot
  for (const c of circ.components) {
    const old = states.get(c.id);
    if (old && old[0] === c.type) for (const k of live) if (k in old[1]) c.state[k] = old[1][k];
    if (c.type === 'numpad') c.state.value = Math.min(c.state.max, Math.max(c.state.min, c.state.value));
  }
  sel = null; multi.c.clear(); multi.w.clear();
  inspKey = undefined;
  refresh(false);
  syncClockPhases();
  autosave(circ);
}

function refresh(save = true) {
  out = simulate(circ, out);
  draw();
  if (save) { record(); syncClockPhases(); autosave(circ); }
}

function fit() {
  if (!circ.components.length) { view = { x: 40, y: 60, k: 1 }; return; }
  const r = svg.getBoundingClientRect();
  const xs = circ.components.flatMap((c) => [c.x, c.x + dims(c).w]);
  const ys = circ.components.flatMap((c) => [c.y, c.y + dims(c).h]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min(1.5, Math.max(0.3, Math.min((r.width - 120) / (x1 - x0), (r.height - 120) / (y1 - y0))));
  view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
}

// ---- drop a part onto a wire to splice it in ------------------------------
let hoverWire = null;
function endPos(e, side) {
  if (e.c === undefined) return e;
  const c = circ.get(e.c);
  return c ? pinPos(c, side, e.p) : null;
}

// The wire passing through part `c` (closest to its centre), if it can be spliced.
function wireUnder(c) {
  const d = dims(c);
  if (!d.ins || !d.outs) return null;
  if (circ.wires.some((w) => w.to.c === c.id && w.to.p === 0)) return null; // input 0 already wired
  const x0 = c.x, y0 = c.y, x1 = c.x + d.w, y1 = c.y + d.h, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let best = null, bestD = Infinity;
  for (const w of circ.wires) {
    if (w.from.c === c.id || w.to.c === c.id) continue;
    const a = endPos(w.from, 'out'), b = endPos(w.to, 'in');
    if (!a || !b) continue;
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    let near = Infinity;
    for (let i = 0; i <= 48; i++) { // sample the same bezier the renderer draws
      const t = i / 48, u = 1 - t;
      const px = u * u * u * a.x + 3 * u * u * t * (a.x + dx) + 3 * u * t * t * (b.x - dx) + t * t * t * b.x;
      const py = u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y;
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) near = Math.min(near, Math.hypot(px - cx, py - cy));
    }
    if (near < bestD) { bestD = near; best = w; }
  }
  return best;
}

// A -> B becomes A -> part.in[0], part.out[0] -> B
function spliceInto(c, w) {
  circ.removeWire(w.id);
  circ.connect(w.from, { c: c.id, p: 0 });
  circ.connect({ c: c.id, p: 0 }, w.to);
}

// ---- canvas interaction -------------------------------------------------
function marqueeRect(d) {
  return { x0: Math.min(d.a.x, d.b.x), y0: Math.min(d.a.y, d.b.y), x1: Math.max(d.a.x, d.b.x), y1: Math.max(d.a.y, d.b.y) };
}

function selectInRect(d) {
  const r = marqueeRect(d);
  multi.c.clear(); multi.w.clear();
  for (const c of circ.components) {
    const m = dims(c);
    if (c.x <= r.x1 && c.x + m.w >= r.x0 && c.y <= r.y1 && c.y + m.h >= r.y0) multi.c.add(c.id);
  }
  const inside = (q) => q && q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1;
  for (const w of circ.wires) {
    if (inside(endPos(w.from, 'out')) && inside(endPos(w.to, 'in'))) multi.w.add(w.id);
  }
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { // right-drag on empty canvas: box-select
    if (e.target.closest('[data-comp],[data-wire],[data-pin],[data-wireend]')) return;
    const p = toWorld(e);
    sel = null; multi.c.clear(); multi.w.clear();
    drag = { type: 'marquee', a: p, b: p };
    draw();
    addDragListeners();
    return;
  }
  if (e.button !== 0) return;
  const t = e.target, p = toWorld(e);
  const pin = t.closest('[data-pin]'), ctl = t.closest('[data-ctl]');
  const comp = t.closest('[data-comp]'), wire = t.closest('[data-wire]');
  const endH = t.closest('[data-wireend]');

  if (endH) { // grab an open wire end: re-drag it from the pinned end
    const w = circ.wires.find((x) => x.id === +endH.dataset.wire);
    circ.removeWire(w.id);
    drag = endH.dataset.wireend === 'to'
      ? { type: 'wire', side: 'out', from: w.from, pos: p }
      : { type: 'wire', side: 'in', to: w.to, pos: p };
    sel = null; multi.c.clear(); multi.w.clear();
  } else if (pin) {
    const c = +pin.dataset.c, pi = +pin.dataset.p;
    if (pin.dataset.pin === 'out') drag = { type: 'wire', side: 'out', from: { c, p: pi }, pos: p };
    else {
      const w = circ.wires.find((x) => x.to.c === c && x.to.p === pi);
      if (w) { // pick the wire back up from its input end
        circ.removeWire(w.id);
        drag = { type: 'wire', side: 'out', from: w.from, pos: p };
      } else drag = { type: 'wire', side: 'in', to: { c, p: pi }, pos: p };
    }
    sel = null; multi.c.clear(); multi.w.clear();
  } else if (ctl) {
    const c = circ.get(+ctl.dataset.c);
    sel = { kind: 'c', id: c.id };
    const a = ctl.dataset.ctl;
    if (a === 'toggle') c.state.on = !c.state.on;
    else if (a === 'press') { c.state.down = true; drag = { type: 'press', c }; }
    else if (a === 'num') c.state.value = +ctl.dataset.v;
    else if (a === 'step') c.state.value = Math.min(c.state.max, Math.max(c.state.min, c.state.value + +ctl.dataset.v));
    else if (a === 'run') c.state.running = !c.state.running;
    refresh();
    if (drag) addDragListeners();
    return;
  } else if (comp) {
    const c = circ.get(+comp.dataset.comp);
    if (multi.c.has(c.id)) { // drag the whole box selection together
      drag = {
        type: 'movemulti', p0: p,
        cs: circ.components.filter((x) => multi.c.has(x.id)).map((x) => ({ c: x, x: x.x, y: x.y })),
        ws: circ.wires.filter((w) => multi.w.has(w.id) && w.from.c === undefined && w.to.c === undefined)
          .map((w) => ({ w, a: { ...w.from }, b: { ...w.to } })),
      };
    } else {
      multi.c.clear(); multi.w.clear();
      sel = { kind: 'c', id: c.id };
      drag = { type: 'move', c, dx: p.x - c.x, dy: p.y - c.y };
    }
  } else if (wire) {
    const w = circ.wires.find((x) => x.id === +wire.dataset.wire);
    const at = (e, side) => (e.c === undefined ? e : pinPos(circ.get(e.c), side, e.p));
    const a = at(w.from, 'out'), b = at(w.to, 'in');
    const da = Math.hypot(a.x - p.x, a.y - p.y), db = Math.hypot(b.x - p.x, b.y - p.y);
    const reach = 30 / view.k;
    if (Math.min(da, db) < reach) { // grabbed near an end: detach that end
      circ.removeWire(w.id);
      drag = da <= db
        ? { type: 'wire', side: 'in', to: w.to, pos: p }
        : { type: 'wire', side: 'out', from: w.from, pos: p };
      sel = null; multi.c.clear(); multi.w.clear();
    } else {
      sel = { kind: 'w', id: w.id };
      if (w.from.c === undefined && w.to.c === undefined) {
        drag = { type: 'movewire', w, p0: p, a: { ...w.from }, b: { ...w.to } };
      }
    }
  } else {
    sel = null; multi.c.clear(); multi.w.clear();
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  }
  draw();
  if (drag) addDragListeners();
});

function addDragListeners() {
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function onMove(e) {
  if (!drag) return;
  if (drag.type === 'move') {
    const p = toWorld(e);
    drag.c.x = snap(p.x - drag.dx); drag.c.y = snap(p.y - drag.dy);
    drag.moved = true;
    hoverWire = wireUnder(drag.c)?.id ?? null;
    draw();
  } else if (drag.type === 'pan') {
    view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy;
    draw();
  } else if (drag.type === 'wire') {
    drag.pos = toWorld(e);
    draw();
  } else if (drag.type === 'marquee') {
    drag.b = toWorld(e);
    selectInRect(drag);
    draw();
  } else if (drag.type === 'movemulti') {
    const p = toWorld(e), dx = snap(p.x - drag.p0.x), dy = snap(p.y - drag.p0.y);
    for (const o of drag.cs) { o.c.x = o.x + dx; o.c.y = o.y + dy; }
    for (const o of drag.ws) {
      o.w.from = { x: o.a.x + dx, y: o.a.y + dy };
      o.w.to = { x: o.b.x + dx, y: o.b.y + dy };
    }
    draw();
  } else if (drag.type === 'movewire') {
    const p = toWorld(e), dx = snap(p.x - drag.p0.x), dy = snap(p.y - drag.p0.y);
    drag.w.from = { x: drag.a.x + dx, y: drag.a.y + dy };
    drag.w.to = { x: drag.b.x + dx, y: drag.b.y + dy };
    draw();
  }
}

// Find the pin a dropped wire should land on: the exact pin if hit, else the
// nearest matching pin on the component under the cursor; none on empty canvas.
function pinAt(e, side) {
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const exact = hit?.closest?.('[data-pin]');
  if (exact && exact.dataset.pin === side) return { c: +exact.dataset.c, p: +exact.dataset.p };
  const over = hit?.closest?.('[data-comp]');
  const overId = over ? +over.dataset.comp : null;
  const w = toWorld(e);
  let best = null, bestD = Infinity;
  for (const c of circ.components) {
    if (overId !== null && c.id !== overId) continue;
    const n = side === 'in' ? dims(c).ins : dims(c).outs;
    for (let i = 0; i < n; i++) {
      const q = pinPos(c, side, i), dist = Math.hypot(q.x - w.x, q.y - w.y);
      if (dist < bestD) { bestD = dist; best = { c: c.id, p: i }; }
    }
  }
  return overId !== null ? best : null; // empty canvas → open-ended wire
}

function onUp(e) {
  window.removeEventListener('pointermove', onMove);
  const d = drag; drag = null;
  hoverWire = null;
  if (d?.type === 'move' && d.moved) { const w = wireUnder(d.c); if (w) spliceInto(d.c, w); }
  if (d?.type === 'press') d.c.state.down = false;
  if (d?.type === 'wire') {
    const target = pinAt(e, d.side === 'out' ? 'in' : 'out');
    const free = (() => { const w = toWorld(e); return { x: snap(w.x), y: snap(w.y) }; })();
    if (d.side === 'out') circ.connect(d.from, target ?? free);
    else circ.connect(target ?? free, d.to);
  }
  refresh();
}

svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const comp = e.target.closest('[data-comp]'), wire = e.target.closest('[data-wire]');
  if (comp) circ.remove(+comp.dataset.comp);
  else if (wire) circ.removeWire(+wire.dataset.wire);
  else return;
  sel = null; multi.c.clear(); multi.w.clear();
  refresh();
});

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0015)));
  view.x = mx - ((mx - view.x) / view.k) * k;
  view.y = my - ((my - view.y) / view.k) * k;
  view.k = k;
  draw();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && (multi.c.size || multi.w.size)) {
    e.preventDefault();
    for (const id of multi.w) circ.removeWire(id);
    for (const id of multi.c) circ.remove(id);
    multi.c.clear(); multi.w.clear();
    refresh();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
    e.preventDefault();
    if (sel.kind === 'c') circ.remove(sel.id); else circ.removeWire(sel.id);
    sel = null; multi.c.clear(); multi.w.clear();
    refresh();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    stepHistory(e.shiftKey ? 1 : -1);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    stepHistory(1);
  } else if (e.key === 'Escape') { sel = null; multi.c.clear(); multi.w.clear(); draw(); }
});

// ---- palette (drag parts onto the canvas) -------------------------------
const palette = $('#palette');
let spawnN = 0;
for (const group of GROUPS) {
  const sect = document.createElement('section');
  sect.innerHTML = `<h3>${group}</h3>`;
  const row = document.createElement('div');
  row.className = 'items';
  for (const [type, def] of Object.entries(DEFS).filter(([, d]) => d.group === group)) {
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.type = type;
    item.title = `Drag onto the canvas (or click) — ${def.label}`;
    const pv = el('svg', { viewBox: `-14 -18 ${def.w + 28} ${def.h + 32}`, class: 'pv' });
    pv.append(el('style')); pv.firstChild.textContent = SVG_CSS;
    pv.append(drawComponent({ id: 0, type, x: 0, y: 0, state: type === 'numpad' ? { ...defaultState(type), value: 5 } : defaultState(type) }, {}, new Map()));
    item.append(pv);
    item.insertAdjacentHTML('beforeend', `<span>${def.label}</span>`);
    row.append(item);
  }
  sect.append(row);
  palette.append(sect);
}

{
  const sect = document.createElement('section');
  sect.innerHTML = '<h3>Wiring</h3>';
  const item = document.createElement('div');
  item.className = 'item';
  item.dataset.type = 'wire';
  item.title = 'Free wire with two open ends — drag its ends onto pins';
  const pv = el('svg', { viewBox: '-14 -18 108 50', class: 'pv' });
  pv.append(el('style')); pv.firstChild.textContent = SVG_CSS;
  pv.append(el('path', { class: 'wire', d: 'M0,10 C30,10 50,10 80,10' }));
  pv.append(el('rect', { class: 'endpt', x: -4, y: 6, width: 8, height: 8 }), el('rect', { class: 'endpt', x: 76, y: 6, width: 8, height: 8 }));
  item.append(pv);
  item.insertAdjacentHTML('beforeend', '<span>Wire</span>');
  const row = document.createElement('div');
  row.className = 'items';
  row.append(item);
  sect.append(row);
  palette.append(sect);
}

palette.addEventListener('pointerdown', (e) => {
  const item = e.target.closest('.item');
  if (!item || e.button !== 0) return;
  e.preventDefault();
  const type = item.dataset.type, def = type === 'wire' ? { w: 80, h: 0 } : DEFS[type];
  const ghost = item.querySelector('svg').cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = `${def.w * view.k}px`;
  document.body.append(ghost);
  let moved = false;
  const place = (ev) => { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; };
  place(e);
  const move = (ev) => {
    moved = true; place(ev);
    const p = toWorld(ev);
    const probe = { id: -1, type, x: snap(p.x - def.w / 2), y: snap(p.y - def.h / 2), state: defaultState(type) };
    hoverWire = type === 'wire' ? null : wireUnder(probe)?.id ?? null;
    draw();
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    ghost.remove();
    hoverWire = null;
    const r = svg.getBoundingClientRect();
    let x, y;
    const inside = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
    if (moved && inside) {
      const p = toWorld(ev); x = p.x - def.w / 2; y = p.y - def.h / 2;
    } else if (!moved) { // plain click: drop near the centre, staggered
      const p = toWorld({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      x = p.x - def.w / 2 + (spawnN % 5) * 20; y = p.y - def.h / 2 + (spawnN++ % 5) * 20;
    } else return;
    if (type === 'wire') {
      circ.connect({ x: snap(x), y: snap(y) }, { x: snap(x) + 80, y: snap(y) });
      sel = { kind: 'w', id: circ.wires.at(-1).id };
    } else {
      const c = circ.add(type, snap(x), snap(y));
      sel = { kind: 'c', id: c.id };
      const w = wireUnder(c);
      if (w) spliceInto(c, w);
    }
    hoverWire = null;
    refresh();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
});

// ---- inspector (settings for number pad / display / clock) --------------
const insp = $('#inspector');
let inspKey = null, inspFields = null, inspPreset = null;
const CLOCK_PRESETS = [0.1, 0.25, 0.5, 1, 2, 4, 5, 8, 10, 16, 20, 30];
const INSPECTED = { numpad: 'Number pad', display: 'Display', clock: 'Clock' };

function updateInspector() {
  const c = sel?.kind === 'c' ? circ.get(sel.id) : null;
  const key = c && INSPECTED[c.type] ? c.id : null;
  if (key !== inspKey) {
    inspKey = key;
    insp.replaceChildren();
    insp.hidden = key === null;
    inspFields = inspPreset = null;
    if (key === null) return;
    const field = (label, input) => {
      const l = document.createElement('label');
      l.append(Object.assign(document.createElement('span'), { className: 'label', textContent: label }), input);
      insp.append(l);
      return input;
    };
    const num = (min, max, step = 1) => Object.assign(document.createElement('input'), { type: 'number', min, max, step, className: 'input' });
    insp.append(Object.assign(document.createElement('h3'), { className: 'label', textContent: INSPECTED[c.type] }));
    if (c.type === 'clock') {
      const preset = Object.assign(document.createElement('select'), { className: 'select' });
      for (const hz of CLOCK_PRESETS) preset.append(new Option(`${hz} Hz`, hz));
      preset.append(new Option('Custom', 'custom'));
      inspPreset = field('Speed', preset);
      inspFields = { hz: field('Hz', num(0.05, 30, 'any')) };
      preset.addEventListener('change', () => {
        if (preset.value === 'custom') return;
        circ.configure(circ.get(key), { hz: +preset.value });
        refresh();
      });
    } else {
      const base = Object.assign(document.createElement('select'), { className: 'select' });
      for (const [v, t] of [['bin', 'Binary'], ['dec', 'Decimal'], ['hex', 'Hex']]) base.append(new Option(t, v));
      inspFields = { base: field('Format', base), bits: field('Bits', num(1, 8)) };
      if (c.type === 'numpad') { inspFields.min = field('Min', num(0, 255)); inspFields.max = field('Max', num(0, 255)); }
    }
    for (const [k, input] of Object.entries(inspFields)) {
      input.addEventListener('change', () => {
        circ.configure(circ.get(key), { [k]: k === 'base' ? input.value : +input.value });
        refresh();
      });
    }
  }
  if (inspFields) {
    const s = circ.get(inspKey).state;
    for (const [k, input] of Object.entries(inspFields)) if (document.activeElement !== input) input.value = s[k];
    if (inspPreset) inspPreset.value = CLOCK_PRESETS.includes(s.hz) ? s.hz : 'custom';
  }
}

// ---- toolbar ------------------------------------------------------------
function loadExample(name) {
  circ.clear(); out = {}; sel = null; multi.c.clear(); multi.w.clear(); clockNext.clear();
  EXAMPLES[name](circ);
  // Examples always start from a known, shared point: every clock low, phase 0.
  for (const c of circ.components) if (c.type === 'clock') { c.state.on = false; c.state.phase = 0; }
  fit(); refresh();
}

const exSel = $('#examples');
for (const name of Object.keys(EXAMPLES)) exSel.append(new Option(name, name));
exSel.addEventListener('change', () => { if (exSel.value) loadExample(exSel.value); exSel.value = ''; });

$('#btn-new').onclick = () => {
  if (circ.components.length && !confirm('Clear the whole workspace?')) return;
  circ.clear(); out = {}; sel = null; multi.c.clear(); multi.w.clear(); refresh();
};
$('#btn-save').onclick = () => { syncClockPhases(); saveFile(circ); };
$('#btn-open').onclick = () => $('#file').click();
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { out = {}; await loadFile(circ, f); clockNext.clear(); sel = null; multi.c.clear(); multi.w.clear(); fit(); refresh(); }
  catch (err) { alert(`Could not open file: ${err.message}`); }
});
$('#btn-undo').onclick = () => stepHistory(-1);
$('#btn-redo').onclick = () => stepHistory(1);
$('#btn-fit').onclick = () => { fit(); draw(); };

// ---- schematic export dialog (PNG / SVG with preview + settings) -----------
const exDlg = $('#export-dlg'), exPrev = $('#e-preview');
let exOpts = { ...DEFAULT_EXPORT };
try { exOpts = { ...exOpts, ...JSON.parse(localStorage.getItem('gatewright.export') || '{}') }; } catch { /* defaults */ }

function renderExportDialog() {
  $('#e-wire').value = exOpts.wireStyle;
  $('#e-in').checked = exOpts.subInputs;
  $('#e-out').checked = exOpts.subOutputs;
  $('#e-off').checked = exOpts.deactivateInputs;
  exPrev.className = 'dlg-preview' + ($('#e-zoom').value === 'fit' ? ' fit' : '');
  const empty = !circ.components.length;
  exPrev.innerHTML = empty ? '<div class="empty">Nothing to export yet — add some parts to the canvas.</div>' : buildSchematic(circ, out, exOpts).svg;
  $('#e-svg').disabled = $('#e-png').disabled = empty;
}
function setExport(patch) {
  exOpts = { ...exOpts, ...patch };
  try { localStorage.setItem('gatewright.export', JSON.stringify(exOpts)); } catch { /* storage unavailable */ }
  renderExportDialog();
}
$('#btn-export').onclick = () => { renderExportDialog(); exDlg.showModal(); };
$('#e-wire').addEventListener('change', (e) => setExport({ wireStyle: e.target.value }));
$('#e-in').addEventListener('change', (e) => setExport({ subInputs: e.target.checked }));
$('#e-out').addEventListener('change', (e) => setExport({ subOutputs: e.target.checked }));
$('#e-off').addEventListener('change', (e) => setExport({ deactivateInputs: e.target.checked }));
$('#e-zoom').addEventListener('change', renderExportDialog);
$('#e-close').onclick = () => exDlg.close();
exDlg.addEventListener('click', (e) => { if (e.target === exDlg) exDlg.close(); });
$('#e-svg').onclick = () => exportSVG(circ, out, exOpts);
$('#e-png').onclick = () => exportPNG(circ, out, exOpts);

// ---- transistor-level circuit export -------------------------------------
const dlg = $('#circuit-dlg'), cTech = $('#c-tech'), cZoom = $('#c-zoom'), cPrev = $('#c-preview');
const cDiode = $('#c-diode');
const cColor = $('#c-color');
const circuitOpts = () => ({ diode: cTech.value === 'relay' && cDiode.checked, color: cColor.checked });
function renderCircuitDialog() {
  $('#c-diode-wrap').hidden = cTech.value !== 'relay';
  const r = circuitSchematic(circ, cTech.value, circuitOpts());
  const empty = !r.nl.stages.length && !r.nl.inputs.length && !r.nl.outputs.length;
  cPrev.className = 'dlg-preview' + (cZoom.value === 'fit' ? ' fit' : '');
  if (empty) cPrev.innerHTML = '<div class="empty">Nothing to draw yet — add some parts to the canvas.</div>';
  else cPrev.innerHTML = r.svg;
  $('#c-stats').textContent = empty ? '' : `${cTech.value === 'relay' ? `${r.relays} relays` : `${r.transistors} transistors`} · ${r.stages} stages`;
  $('#c-svg').disabled = $('#c-png').disabled = empty;
}
$('#btn-circuit').onclick = () => { renderCircuitDialog(); dlg.showModal(); };
cTech.addEventListener('change', renderCircuitDialog);
cDiode.addEventListener('change', renderCircuitDialog);
cColor.addEventListener('change', renderCircuitDialog);
cZoom.addEventListener('change', renderCircuitDialog);
$('#c-close').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
$('#c-svg').onclick = () => exportCircuitSVG(circ, cTech.value, circuitOpts());
$('#c-png').onclick = () => exportCircuitPNG(circ, cTech.value, circuitOpts());

// ---- clock ticks --------------------------------------------------------
// Each clock keeps a phase in [0,2): 0..1 = low half, 1..2 = high half. Level
// is derived from elapsed time (no drift, clocks stay aligned). The phase is
// written into the saved state, so reopening a project resumes every clock at
// the same relative position, i.e. still in sync.
const clockNext = new Map(); // part id -> {t0, p, hz}

function clockPhase(c, now = performance.now()) {
  const ph = clockNext.get(c.id);
  if (ph) return (ph.p + (now - ph.t0) / (500 / ph.hz)) % 2;
  return c.state.phase ?? (c.state.on ? 1 : 0);
}

function syncClockPhases() {
  const now = performance.now();
  for (const c of circ.components) if (c.type === 'clock') c.state.phase = +clockPhase(c, now).toFixed(4);
}

setInterval(() => {
  const now = performance.now();
  let any = false;
  for (const c of circ.components) {
    if (c.type !== 'clock') continue;
    let ph = clockNext.get(c.id);
    if (!c.state.running) {
      if (ph) { c.state.phase = clockPhase(c, now); clockNext.delete(c.id); } // freeze
      continue;
    }
    if (!ph || ph.hz !== c.state.hz) { // new, resumed, loaded, or retuned
      const p = ph ? clockPhase(c, now) : (c.state.phase ?? (c.state.on ? 1 : 0));
      ph = { t0: now, p, hz: c.state.hz };
      clockNext.set(c.id, ph);
    }
    const on = Math.floor(ph.p + (now - ph.t0) / (500 / ph.hz)) & 1;
    if (on !== (c.state.on ? 1 : 0)) { c.state.on = !!on; any = true; }
  }
  if (any) refresh(false);
}, 8);

// ---- boot ---------------------------------------------------------------
if (restore(circ)) { fit(); refresh(false); record(); } else loadExample('Half adder');
window.addEventListener('resize', draw);
requireDisclaimer();
