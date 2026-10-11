// Circuitwright: editor interaction, simulation loop, inspector, dialogs.
import { Circuit, DEFS, GROUPS, snap, fmt, parseVal, circuitBounds, compBox, rotPt } from './model.js';
import { buildNetlist, toSpice } from './netlist.js';
import { Sim, autoStep, autoSpan } from './solver.js';
import { Scene, el, SVG_CSS } from './render.js';
import { previewSVG } from './symbols.js';
import { Scope, niceTime } from './scope.js';
import { EXAMPLES } from './examples.js';
import { autosave, restore, saveFile, loadFile, download } from './storage.js';
import { buildSchematic, exportSVG, exportPNG } from './export.js';
import { requireDisclaimer } from './disclaimer.js';

const $ = (s) => document.querySelector(s);
const ws = $('#ws'), world = $('#world'), overlay = $('#overlay');
const circ = new Circuit();
const store = new Map();              // element state that survives netlist rebuilds
const scene = new Scene(world);
const scope = new Scope($('#scope'));

let nl = null, sim = null;
let simTime = 0, acc = 0, dt = 1e-5;
let running = true, speed = 1, userPerDiv = null, userVdiv = 0;
let dirty = true, inspDirty = true;
let selection = new Set();            // 'c<id>' and 'w<id>'
let view = { x: 40, y: 40, k: 1 };
let drag = null;
const undoStack = [], redoStack = [];
let clipboard = null;

// ---- view -------------------------------------------------------------------
function applyView() {
  const t = `translate(${view.x} ${view.y}) scale(${view.k})`;
  world.setAttribute('transform', t);
  overlay.setAttribute('transform', t);
  for (const id of ['grid', 'grid5']) $('#' + id).setAttribute('patternTransform', t);
  $('#gridrect').style.display = view.k < 0.55 ? 'none' : '';
}
function toWorld(cx, cy) {
  const r = ws.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
}
function fit() {
  const b = circuitBounds(circ);
  const r = ws.getBoundingClientRect();
  if (!b) { view = { x: 40, y: 40, k: 1 }; applyView(); return; }
  const pad = 70, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
  const k = Math.max(0.35, Math.min(2, r.width / w, r.height / h));
  view = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k };
  applyView();
}

// ---- history ----------------------------------------------------------------
const snapshot = () => JSON.stringify(circ.toJSON());
function commit() {
  const s = snapshot();
  if (undoStack.length && undoStack[undoStack.length - 1] === s) return;
  undoStack.push(s);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  autosave(circ);
  syncHistoryButtons();
}
function restoreSnap(s) {
  circ.load(JSON.parse(s));
  selection.clear();
  markDirty();
  autosave(circ);
  syncHistoryButtons();
}
function undo() { if (undoStack.length > 1) { redoStack.push(undoStack.pop()); restoreSnap(undoStack[undoStack.length - 1]); } }
function redo() { if (redoStack.length) { const s = redoStack.pop(); undoStack.push(s); restoreSnap(s); } }
function syncHistoryButtons() {
  $('#btn-undo').disabled = undoStack.length < 2;
  $('#btn-redo').disabled = !redoStack.length;
}
function markDirty() { dirty = true; inspDirty = true; }

// ---- simulation ---------------------------------------------------------------
function resetStates() {
  store.clear();
  for (const c of circ.components) {
    const d = DEFS[c.type].state;
    if (!d) continue;
    for (const k of Object.keys(d)) if (!['closed', 'pos'].includes(k)) c.state[k] = d[k];
  }
}
function resetSim() {
  resetStates();
  simTime = 0; acc = 0;
  scope.clear();
  markDirty();
}

function channelsOf(n) {
  const ch = [];
  for (const p of n.probes) ch.push({ id: 'p' + p.id, label: p.label, kind: 'v', get: (s) => s.v(p.net) });
  for (const e of n.elems) {
    if (e.type === 'voltmeter') ch.push({ id: 'm' + e.id, label: e.label, kind: 'v', get: (s) => s.info(e.id)?.v ?? 0 });
    else if (e.type === 'ammeter') ch.push({ id: 'a' + e.id, label: e.label, kind: 'i', get: (s) => s.info(e.id)?.i ?? 0 });
  }
  return ch;
}

function rebuild() {
  nl = buildNetlist(circ);
  scene.build(circ, nl, { selected: selection });
  sim = new Sim(nl, store);
  sim.t = simTime;
  dt = autoStep(nl);
  const span = autoSpan(nl, dt);
  scope.setChannels(channelsOf(nl));
  scope.perDiv = userPerDiv ?? circ.meta.perDiv ?? niceTime(span / 10);
  scope.vdiv = userVdiv;
  syncScopeControls();
  $('#hint').hidden = circ.components.length > 0;
  $('#s-note').textContent = scope.channels.length ? `${scope.channels.length} channel${scope.channels.length > 1 ? 's' : ''}` : 'Probes, voltmeters and ammeters appear here';
}

let last = performance.now();
let lastNon = 0;
function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dirty) { dirty = false; rebuild(); }
  if (inspDirty) { inspDirty = false; buildInspector(); }
  if (sim && running && nl.elems.length) {
    acc += (scope.span() / 2) * speed * real;
    let n = Math.min(Math.floor(acc / dt), 6000);
    acc -= n * dt;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      sim.step(dt);
      scope.sample(sim);
      if ((i & 15) === 15 && performance.now() - t0 > 14) { acc = 0; break; }
    }
    simTime = sim.t;
  }
  scene.paint(sim, {});
  if (!$('#scopepanel').hidden) scope.draw();
  liveInspector();
  statusLine();
  requestAnimationFrame(frame);
}

function statusLine() {
  const s = $('#status');
  const warn = nl?.warnings?.[0] || (sim && sim.nonconv > lastNon + 5 ? 'Solver is struggling: look for shorted sources or ideal loops.' : '');
  if (sim && sim.nonconv <= lastNon) lastNon = sim.nonconv;
  if (warn) { s.textContent = warn; s.className = 'label warn'; return; }
  s.className = 'label';
  s.textContent = nl?.elems.length ? `t = ${fmt(simTime, 's')} · Δt ${fmt(dt, 's')}${running ? '' : ' · paused'}` : '';
}

// ---- helpers --------------------------------------------------------------------
const selComps = () => [...selection].filter((s) => s[0] === 'c').map((s) => circ.comp(+s.slice(1))).filter(Boolean);
const selWires = () => [...selection].filter((s) => s[0] === 'w').map((s) => circ.wire(+s.slice(1))).filter(Boolean);
const isForm = (t) => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);

function setSelection(ids) {
  const next = new Set(ids);
  if (next.size === selection.size && [...next].every((k) => selection.has(k))) return;
  selection = next;
  markDirty();
}

function placePart(type, x, y) {
  const c = circ.add(type, snap(x), snap(y));
  setSelection(['c' + c.id]);
  commit();
  return c;
}

function deleteSelection() {
  const cs = selComps().map((c) => c.id), ws2 = selWires().map((w) => w.id);
  if (!cs.length && !ws2.length) return;
  circ.remove(cs, ws2);
  selection.clear();
  markDirty();
  commit();
}

function rotateSelection(dir = 1) {
  const cs = selComps();
  if (!cs.length) return;
  if (cs.length === 1) { cs[0].rot = (cs[0].rot + dir + 4) & 3; }
  else {
    const cx = snap(cs.reduce((a, c) => a + c.x, 0) / cs.length), cy = snap(cs.reduce((a, c) => a + c.y, 0) / cs.length);
    const ids = new Set(cs.map((c) => c.id));
    const rp = (p) => { const [dx, dy] = rotPt(p.x - cx, p.y - cy, dir > 0 ? 1 : 3, false); return { x: cx + dx, y: cy + dy }; };
    for (const c of cs) { const p = rp(c); c.x = snap(p.x); c.y = snap(p.y); c.rot = (c.rot + dir + 4) & 3; }
    for (const w of circ.wires) {
      if ([w.a, w.b].some((e) => e.c != null && !ids.has(e.c))) continue;
      for (const e of [w.a, w.b]) if (e.c == null) Object.assign(e, rp(e));
      w.via = (w.via || []).map(rp);
    }
  }
  markDirty(); commit();
}

function flipSelection() {
  const cs = selComps();
  if (!cs.length) return;
  for (const c of cs) c.flip = !c.flip;
  markDirty(); commit();
}

function nudge(dx, dy) {
  const cs = selComps();
  if (!cs.length) return;
  const joined = joinedWires(new Set(cs.map((c) => c.id)));
  for (const c of cs) { c.x += dx; c.y += dy; }
  for (const o of joined) {
    for (const k of ['a', 'b']) if (o.move[k]) { o.w[k].x = o[k].x + dx; o.w[k].y = o[k].y + dy; }
    if (o.move.via) o.w.via = o.via.map((v) => ({ x: v.x + dx, y: v.y + dy }));
  }
  markDirty(); commit();
}

function copySelection() {
  const cs = selComps();
  if (!cs.length) return;
  const ids = new Set(cs.map((c) => c.id));
  clipboard = {
    components: JSON.parse(JSON.stringify(cs)),
    wires: JSON.parse(JSON.stringify(circ.wires.filter((w) => [w.a, w.b].every((e) => e.c == null || ids.has(e.c)) && [w.a, w.b].some((e) => e.c != null)))),
  };
}

function paste() {
  if (!clipboard) return;
  const map = new Map(), made = [];
  for (const c of clipboard.components) {
    const n = circ.add(c.type, c.x + 20, c.y + 20, { rot: c.rot, flip: c.flip, params: c.params, state: c.state });
    map.set(c.id, n.id);
    made.push('c' + n.id);
  }
  for (const w of clipboard.wires) {
    const re = (e) => (e.c != null ? { c: map.get(e.c), p: e.p } : { x: e.x + 20, y: e.y + 20 });
    const nw = circ.addWire(re(w.a), re(w.b), { via: (w.via || []).map((p) => ({ x: p.x + 20, y: p.y + 20 })), style: w.style });
    made.push('w' + nw.id);
  }
  for (const c of clipboard.components) c.x += 20, c.y += 20;
  setSelection(made);
  commit();
}

// geometry: nearest point on a wire, kept on the grid for orthogonal runs
function pointOnWire(wid, p) {
  const pts = nl.wirePts.get(wid) || circ.wirePath(circ.wire(wid));
  let best = null, bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let q;
    if (a.y === b.y) q = { x: Math.min(Math.max(snap(p.x), Math.min(a.x, b.x)), Math.max(a.x, b.x)), y: a.y };
    else if (a.x === b.x) q = { x: a.x, y: Math.min(Math.max(snap(p.y), Math.min(a.y, b.y)), Math.max(a.y, b.y)) };
    else q = Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - b.x, p.y - b.y) ? a : b;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best || p;
}

// ---- palette ----------------------------------------------------------------
function buildPalette() {
  const pal = $('#palette');
  for (const g of GROUPS) {
    const sec = document.createElement('section');
    sec.dataset.group = g;
    const h = document.createElement('h3');
    h.textContent = g;
    const items = document.createElement('div');
    items.className = 'items';
    for (const def of Object.values(DEFS).filter((d) => d.group === g)) {
      const it = document.createElement('div');
      it.className = 'item';
      it.dataset.type = def.type;
      it.title = def.label;
      it.append(previewSVG(def));
      const s = document.createElement('span');
      s.textContent = def.label;
      it.append(s);
      items.append(it);
    }
    sec.append(h, items);
    pal.append(sec);
  }
  $('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const it of pal.querySelectorAll('.item')) {
      const d = DEFS[it.dataset.type];
      it.hidden = !!q && !(d.label.toLowerCase().includes(q) || d.type.includes(q) || d.group.toLowerCase().includes(q));
    }
    for (const s of pal.querySelectorAll('section')) s.hidden = ![...s.querySelectorAll('.item')].some((i) => !i.hidden);
  });
  // A palette drag follows the pointer on the document, so it always ends: on release anywhere,
  // on cancel, when the window loses focus, or when a move arrives with no button held (a release
  // that was swallowed by a context menu or happened outside the window).
  let pd = null;
  const stop = () => {
    if (!pd) return;
    pd.ghost?.remove();
    document.querySelectorAll('.ghost').forEach((g) => g.remove());
    pd = null;
  };
  pal.addEventListener('pointerdown', (e) => {
    stop();
    if (e.button !== 0) return;
    const it = e.target.closest('.item');
    if (!it) return;
    e.preventDefault();
    pd = { type: it.dataset.type, x: e.clientX, y: e.clientY, ghost: null, src: it };
  });
  document.addEventListener('pointermove', (e) => {
    if (!pd) return;
    if (!(e.buttons & 1)) { stop(); return; }
    if (!pd.ghost && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) > 5) {
      pd.ghost = pd.src.querySelector('svg').cloneNode(true);
      pd.ghost.setAttribute('class', 'ghost');
      document.body.append(pd.ghost);
    }
    if (pd.ghost) { pd.ghost.style.left = e.clientX + 'px'; pd.ghost.style.top = e.clientY + 'px'; }
  });
  document.addEventListener('pointerup', (e) => {
    if (!pd || e.button !== 0) return;
    const r = ws.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const { type, ghost } = pd;
    stop();
    if (ghost) {
      if (inside) { const p = toWorld(e.clientX, e.clientY); placePart(type, p.x, p.y); }
    } else {
      const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      const n = circ.components.length;
      placePart(type, p.x + (n % 5) * 20, p.y + (n % 5) * 20);
    }
  });
  document.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
  document.addEventListener('contextmenu', stop);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stop(); });
}

// Joints travel with the parts they hang off. Starting from the moved parts, a free wire end
// (a branch point, a dangling joint) follows when a wire runs from it to a moved pin, when it is
// shared with a joint that moves, or when it sits on the run of a wire that moves as a whole.
function joinedWires(ids) {
  const key = (e) => e.x + ',' + e.y;
  const moving = new Set();
  const whole = new Set();
  const live = (e) => (e.c != null ? ids.has(e.c) : moving.has(key(e)));
  for (const w of circ.wires) if (selection.has('w' + w.id)) for (const e of [w.a, w.b]) if (e.c == null) moving.add(key(e));
  for (let changed = true; changed;) {
    changed = false;
    for (const w of circ.wires) {
      const a = live(w.a), b = live(w.b);
      if (a && b) { if (!whole.has(w.id)) { whole.add(w.id); changed = true; } }
      else if (a && w.b.c == null) { moving.add(key(w.b)); changed = true; }
      else if (b && w.a.c == null) { moving.add(key(w.a)); changed = true; }
    }
    // branch points sitting on the run of a wire that moves, or is dragged along by one end
    const carried = new Set(whole);
    for (const w of circ.wires) if (live(w.a) !== live(w.b)) carried.add(w.id);
    for (const id of carried) {
      const pts = circ.wirePath(circ.wire(id));
      for (const o of circ.wires) {
        for (const e of [o.a, o.b]) {
          if (e.c != null || moving.has(key(e))) continue;
          for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1], q = pts[i];
            const cross = (q.x - p.x) * (e.y - p.y) - (q.y - p.y) * (e.x - p.x);
            const dot = (e.x - p.x) * (q.x - p.x) + (e.y - p.y) * (q.y - p.y);
            if (cross === 0 && dot >= 0 && dot <= (q.x - p.x) ** 2 + (q.y - p.y) ** 2) { moving.add(key(e)); changed = true; break; }
          }
        }
      }
    }
  }
  const out = [];
  for (const w of circ.wires) {
    const move = { a: w.a.c == null && moving.has(key(w.a)), b: w.b.c == null && moving.has(key(w.b)), via: whole.has(w.id) };
    if (move.a || move.b || move.via) out.push({ w, a: { ...w.a }, b: { ...w.b }, via: (w.via || []).map((v) => ({ ...v })), move });
  }
  return out;
}

// ---- canvas interaction -------------------------------------------------------
function ghostWire(a, b, diag) {
  overlay.querySelector('.ghostwire')?.remove();
  const pts = circ.wirePath({ a, b, via: [], style: diag ? 'diag' : 'auto' });
  overlay.append(el('path', { class: 'wire ghost ghostwire', d: 'M' + pts.map((p) => `${p.x},${p.y}`).join('L') }));
}
function clearOverlay() { overlay.replaceChildren(); }

ws.addEventListener('pointerdown', (e) => {
  ws.setPointerCapture(e.pointerId);
  const t = e.target;
  const p = toWorld(e.clientX, e.clientY);
  if (e.button === 2) {
    // Hold right button and drag to box-select; a plain right-click deletes what is under it.
    hideTip();
    drag = { kind: 'box', right: true, x0: p.x, y0: p.y, sx: e.clientX, sy: e.clientY, p, add: e.shiftKey,
      comp: t.closest?.('[data-comp]')?.dataset.comp, wire: t.closest?.('[data-wire]')?.dataset.wire };
    return;
  }
  const pin = t.closest?.('[data-pin]');
  const comp = t.closest?.('[data-comp]');
  const wire = t.closest?.('[data-wire]');
  hideTip();
  if (e.button === 1) { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; ws.classList.add('panning'); return; }
  if (pin) {
    const [cid, pi] = pin.dataset.pin.split(':').map(Number);
    drag = { kind: 'wire', a: { c: cid, p: pi }, moved: false, sx: e.clientX, sy: e.clientY };
    ws.classList.add('wiring');
  } else if (comp) {
    const id = +comp.dataset.comp, key = 'c' + id;
    if (e.shiftKey) { selection.has(key) ? selection.delete(key) : selection.add(key); markDirty(); }
    else if (!selection.has(key)) setSelection([key]);
    const c = circ.comp(id);
    const ids = new Set(selComps().map((x) => x.id));
    drag = {
      kind: 'move', id, sx: e.clientX, sy: e.clientY, start: p, moved: false,
      comps: selComps().map((x) => ({ c: x, x: x.x, y: x.y })),
      wires: joinedWires(ids),
    };
    if (c.type === 'button') { c.state.closed = true; drag.pressed = true; }
  } else if (wire) {
    const id = +wire.dataset.wire;
    setSelection(e.shiftKey ? [...selection, 'w' + id] : ['w' + id]);
    drag = { kind: 'branch', wid: id, sx: e.clientX, sy: e.clientY, p };
  } else if (e.shiftKey) {
    drag = { kind: 'box', x0: p.x, y0: p.y, add: true };
  } else {
    if (selection.size) setSelection([]);
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    ws.classList.add('panning');
  }
});

ws.addEventListener('pointermove', (e) => {
  const p = toWorld(e.clientX, e.clientY);
  if (!drag) { showTip(e); return; }
  if (!e.buttons) { endDrag(e); return; }   // the release was lost (context menu, left the window)
  const moved = Math.hypot(e.clientX - (drag.sx ?? e.clientX), e.clientY - (drag.sy ?? e.clientY)) > 3;
  switch (drag.kind) {
    case 'pan':
      view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy;
      applyView();
      break;
    case 'move': {
      if (!drag.moved && !moved) break;
      drag.moved = true;
      const dx = snap(p.x - drag.start.x), dy = snap(p.y - drag.start.y);
      for (const o of drag.comps) { o.c.x = o.x + dx; o.c.y = o.y + dy; }
      for (const o of drag.wires) {
        for (const k of ['a', 'b']) if (o.move[k]) { o.w[k].x = o[k].x + dx; o.w[k].y = o[k].y + dy; }
        if (o.move.via) o.w.via = o.via.map((v) => ({ x: v.x + dx, y: v.y + dy }));
      }
      markDirty();
      break;
    }
    case 'branch':
      if (moved) {
        const s = pointOnWire(drag.wid, drag.p);
        drag = { kind: 'wire', a: { x: s.x, y: s.y }, moved: true, sx: e.clientX, sy: e.clientY };
        ws.classList.add('wiring');
      }
      break;
    case 'wire': {
      if (moved) drag.moved = true;
      if (!drag.moved) break;
      let end = { x: snap(p.x), y: snap(p.y) };
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-pin]');
      if (under) { const [cid, pi] = under.dataset.pin.split(':').map(Number); end = { c: cid, p: pi }; }
      drag.end = end;
      ghostWire(drag.a, end, e.shiftKey);
      break;
    }
    case 'box': {
      overlay.querySelector('.marquee')?.remove();
      const x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y);
      overlay.append(el('rect', { class: 'marquee', x, y, width: Math.abs(p.x - drag.x0), height: Math.abs(p.y - drag.y0) }));
      drag.p = p;
      break;
    }
  }
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  ws.classList.remove('panning', 'wiring');
  clearOverlay();
  switch (d.kind) {
    case 'move': {
      const c = circ.comp(d.id);
      if (d.pressed && c) c.state.closed = false;
      if (d.moved) commit();
      else if (c) {
        if (c.type === 'switch') { c.state.closed = !c.state.closed; autosave(circ); }
        else if (c.type === 'spdt') { c.state.pos = c.state.pos ? 0 : 1; autosave(circ); }
        if (!e.shiftKey && selection.size > 1) setSelection(['c' + d.id]);
      }
      break;
    }
    case 'wire': {
      if (!d.moved) { const c = d.a.c != null ? circ.comp(d.a.c) : null; if (c) setSelection(['c' + c.id]); break; }
      let end = d.end;
      if (!end) break;
      const same = (a, b) => (a.c != null ? a.c === b.c && a.p === b.p : b.c == null && a.x === b.x && a.y === b.y);
      if (same(d.a, end)) break;
      if (end.c == null && d.a.c == null) { const pa = circ.endPos(d.a); if (pa.x === end.x && pa.y === end.y) break; }
      const w = circ.addWire(d.a, end, { style: e.shiftKey ? 'diag' : 'auto' });
      circ.snapEnds();
      setSelection(['w' + w.id]);
      commit();
      break;
    }
    case 'box': {
      if (d.right && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 4) {
        if (d.comp) circ.remove([+d.comp], []);
        else if (d.wire) circ.remove([], [+d.wire]);
        else { setSelection([]); break; }
        selection.clear(); markDirty(); commit();
        break;
      }
      const p = d.p || { x: d.x0, y: d.y0 };
      const x0 = Math.min(d.x0, p.x), x1 = Math.max(d.x0, p.x), y0 = Math.min(d.y0, p.y), y1 = Math.max(d.y0, p.y);
      const ids = d.add || !d.right ? [...selection] : [];
      for (const c of circ.components) { const b = compBox(c); if (b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1) ids.push('c' + c.id); }
      for (const w of circ.wires) if (circ.wirePath(w).every((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1)) ids.push('w' + w.id);
      setSelection(ids);
      break;
    }
    default: break;
  }
}
ws.addEventListener('pointerup', endDrag);
ws.addEventListener('lostpointercapture', (e) => { if (drag && !e.buttons) endDrag(e); });
window.addEventListener('blur', () => { if (drag) endDrag({}); });
ws.addEventListener('pointercancel', endDrag);

ws.addEventListener('dblclick', (e) => {
  const wire = e.target.closest?.('[data-wire]');
  if (!wire) return;
  const w = circ.wire(+wire.dataset.wire);
  const order = ['auto', 'hv', 'vh', 'diag'];
  w.style = order[(order.indexOf(w.style || 'auto') + 1) % order.length];
  markDirty(); commit();
});

ws.addEventListener('contextmenu', (e) => e.preventDefault());

ws.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = ws.getBoundingClientRect();
  const k = Math.max(0.25, Math.min(3, view.k * Math.exp(-e.deltaY * 0.0015)));
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  view.x = mx - (mx - view.x) * (k / view.k);
  view.y = my - (my - view.y) * (k / view.k);
  view.k = k;
  applyView();
}, { passive: false });

// ---- tooltip -------------------------------------------------------------------
const tip = $('#tip');
function hideTip() { tip.hidden = true; }
function describe(c, info) {
  const L = [];
  const v = info?.v ?? 0, i = info?.i ?? 0;
  switch (c.type) {
    case 'npn': case 'pnp': L.push(`Vce ${fmt(v, 'V')}`, `Vbe ${fmt(info?.vbe ?? 0, 'V')}`, `Ic ${fmt(i, 'A')}`, `Ib ${fmt(info?.ib ?? 0, 'A')}`); break;
    case 'nmos': case 'pmos': case 'njfet': case 'pjfet': L.push(`Vds ${fmt(v, 'V')}`, `Vgs ${fmt(info?.vgs ?? 0, 'V')}`, `Id ${fmt(i, 'A')}`); break;
    case 'opamp': L.push(`Vout ${fmt(info?.v ?? 0, 'V')}`, `V+ − V− ${fmt(info?.vd ?? 0, 'V')}`); break;
    case 'timer555': L.push(`Output ${info?.q ? 'high' : 'low'}`, `Vout ${fmt(info?.v ?? 0, 'V')}`); break;
    case 'relay': L.push(`Coil ${fmt(info?.v ?? 0, 'V')}`, info?.on ? 'Energised' : 'Released'); break;
    case 'transformer': L.push(`Pri ${fmt(v, 'V')} ${fmt(i, 'A')}`, `Sec ${fmt(info?.v2 ?? 0, 'V')} ${fmt(info?.i2 ?? 0, 'A')}`); break;
    case 'fuse': L.push(info?.blown ? 'BLOWN' : `Heat ${Math.round((info?.heat ?? 0) * 100)}%`, `I ${fmt(i, 'A')}`); break;
    case 'scr': L.push(`Vak ${fmt(v, 'V')}`, info?.on ? 'Conducting' : 'Off', `I ${fmt(i, 'A')}`); break;
    case 'ground': case 'vcc': case 'netlabel': case 'probe': break;
    default: if (info) L.push(`V ${fmt(v, 'V')}`, `I ${fmt(i, 'A')}`, `P ${fmt(Math.abs(v * i), 'W')}`);
  }
  return L;
}
function showTip(e) {
  if (!sim || drag) { hideTip(); return; }
  let text = '';
  const pin = e.target.closest?.('[data-pin]'), wire = e.target.closest?.('[data-wire]'), comp = e.target.closest?.('[data-comp]');
  if (pin) {
    const [cid, pi] = pin.dataset.pin.split(':').map(Number);
    const c = circ.comp(cid), net = nl.pinNet.get(pin.dataset.pin);
    text = `${c.label}.${DEFS[c.type].pins[pi][0]}\n${nl.netName.get(net) || 'net ' + net}: ${fmt(sim.v(net), 'V')}`;
  } else if (wire) {
    const net = nl.wireNet.get(+wire.dataset.wire);
    text = `${nl.netName.get(net) || 'net ' + net}: ${fmt(sim.v(net), 'V')}`;
  } else if (comp) {
    const c = circ.comp(+comp.dataset.comp);
    if (c) text = [c.label + '  ' + DEFS[c.type].label, ...describe(c, sim.info(c.id))].join('\n');
  }
  if (!text) { hideTip(); return; }
  const r = $('.canvas-wrap').getBoundingClientRect();
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 200) + 'px';
  tip.style.top = e.clientY - r.top + 14 + 'px';
}
ws.addEventListener('pointerleave', hideTip);

// ---- inspector --------------------------------------------------------------------
const insp = $('#inspector');
let inspReadout = null;

function field(label, input) {
  const l = document.createElement('label');
  const s = document.createElement('span');
  s.textContent = label;
  l.append(s, input);
  return l;
}
function btn(text, fn, cls = 'btn btn--sm') {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

function buildInspector() {
  insp.replaceChildren();
  inspReadout = null;
  const cs = selComps(), wsel = selWires();
  if (!cs.length && !wsel.length) { insp.hidden = true; return; }
  insp.hidden = false;
  const h = document.createElement('h3');
  insp.append(h);
  if (cs.length === 1 && !wsel.length) {
    const c = cs[0], def = DEFS[c.type];
    h.textContent = def.label;
    if (def.ref) {
      const i = document.createElement('input');
      i.className = 'input'; i.value = c.label; i.maxLength = 12;
      i.addEventListener('change', () => { c.label = i.value.trim() || c.label; markDirty(); commit(); });
      insp.append(field('Name', i));
    }
    for (const p of def.params) {
      let input;
      if (p.type === 'sel') {
        input = document.createElement('select');
        input.className = 'select';
        for (const [v, l] of p.opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; input.append(o); }
        input.value = c.params[p.k];
        input.addEventListener('change', () => { c.params[p.k] = input.value; markDirty(); commit(); });
      } else if (p.type === 'bool') {
        input = document.createElement('input');
        input.type = 'checkbox'; input.className = 'check'; input.checked = !!c.params[p.k];
        input.addEventListener('change', () => { c.params[p.k] = input.checked; markDirty(); commit(); });
      } else if (p.type === 'text') {
        input = document.createElement('input');
        input.className = 'input'; input.value = c.params[p.k]; input.maxLength = 10;
        input.addEventListener('change', () => { c.params[p.k] = input.value; markDirty(); commit(); });
      } else {
        input = document.createElement('input');
        input.className = 'input';
        input.value = fmt(c.params[p.k]);
        input.addEventListener('change', () => {
          let v = parseVal(input.value);
          if (Number.isNaN(v)) { input.value = fmt(c.params[p.k]); return; }
          if (p.min !== undefined) v = Math.max(p.min, v);
          if (p.max !== undefined) v = Math.min(p.max, v);
          c.params[p.k] = v;
          input.value = fmt(v);
          markDirty(); commit();
        });
      }
      insp.append(field(p.unit && p.type === 'num' ? `${p.label} (${p.unit})` : p.label, input));
    }
    const row = document.createElement('div');
    row.className = 'row';
    if (c.type === 'switch' || c.type === 'button') {
      row.append(btn(c.state.closed ? 'Open it' : 'Close it', () => { c.state.closed = !c.state.closed; autosave(circ); inspDirty = true; }));
    } else if (c.type === 'spdt') {
      row.append(btn('Throw', () => { c.state.pos = c.state.pos ? 0 : 1; autosave(circ); }));
    } else if (c.type === 'fuse') {
      row.append(btn('Replace fuse', () => { c.state.blown = false; c.state.heat = 0; store.delete(c.id); autosave(circ); markDirty(); }));
    }
    if (row.childNodes.length) insp.append(row);
  } else if (wsel.length === 1 && !cs.length) {
    const w = wsel[0];
    h.textContent = 'Wire';
    const net = nl?.wireNet.get(w.id);
    const s = document.createElement('select');
    s.className = 'select';
    for (const [v, l] of [['auto', 'Auto'], ['hv', 'Across first'], ['vh', 'Up/down first'], ['diag', 'Straight']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.append(o); }
    s.value = w.style || 'auto';
    s.addEventListener('change', () => { w.style = s.value; markDirty(); commit(); });
    insp.append(field('Route', s));
    void net;
  } else {
    h.textContent = `${cs.length + wsel.length} items`;
  }
  const row = document.createElement('div');
  row.className = 'row';
  if (cs.length) {
    row.append(btn('Rotate', () => rotateSelection(1)), btn('Flip', flipSelection));
  }
  row.append(btn('Delete', deleteSelection, 'btn btn--sm btn--danger'));
  insp.append(row);
  inspReadout = document.createElement('div');
  inspReadout.className = 'readout';
  insp.append(inspReadout);
}

function liveInspector() {
  if (!inspReadout || !sim) return;
  const cs = selComps(), wsel = selWires();
  let lines = [];
  if (cs.length === 1) lines = describe(cs[0], sim.info(cs[0].id));
  else if (wsel.length === 1 && !cs.length) {
    const net = nl.wireNet.get(wsel[0].id);
    lines = [`${nl.netName.get(net) || 'net ' + net}: ${fmt(sim.v(net), 'V')}`];
  }
  const s = lines.join('\n');
  if (inspReadout.textContent !== s) inspReadout.textContent = s;
}

// ---- keyboard ---------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (isForm(e.target) || $('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'c') { copySelection(); }
  else if (mod && k === 'x') { copySelection(); deleteSelection(); }
  else if (mod && k === 'v') { e.preventDefault(); paste(); }
  else if (mod && k === 'a') { e.preventDefault(); setSelection([...circ.components.map((c) => 'c' + c.id), ...circ.wires.map((w) => 'w' + w.id)]); }
  else if (mod && k === 'd') { e.preventDefault(); copySelection(); paste(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  else if (k === 'r' && !mod) rotateSelection(e.shiftKey ? -1 : 1);
  else if (k === 'f' && !mod) flipSelection();
  else if (e.key === ' ') { e.preventDefault(); toggleRun(); }
  else if (e.key === 'Escape') { drag = null; clearOverlay(); setSelection([]); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const s = e.shiftKey ? 50 : 10;
    nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
  }
});

// ---- toolbar ------------------------------------------------------------------------
function toggleRun() {
  running = !running;
  $('#btn-run').textContent = running ? 'Pause' : 'Run';
}
$('#btn-run').addEventListener('click', toggleRun);
$('#btn-reset').addEventListener('click', resetSim);
$('#btn-skip').addEventListener('click', () => {
  if (!sim) return;
  const target = sim.t + scope.span() * 2, t0 = performance.now();
  scope.hold = true;                              // do not record the skipped part at full density
  while (sim.t < target && performance.now() - t0 < 1500) sim.step(dt);
  scope.hold = $('#s-hold').classList.contains('is-on');
  scope.clear();
  simTime = sim.t;
});
$('#speed').addEventListener('change', (e) => { speed = +e.target.value; });
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-fit').addEventListener('click', fit);
$('#btn-new').addEventListener('click', () => {
  if (circ.components.length && !confirm('Clear the workspace?')) return;
  circ.load({ app: 'circuitwright', components: [], wires: [] });
  selection.clear(); userPerDiv = null;
  resetSim(); commit();
});
$('#btn-save').addEventListener('click', () => saveFile(circ));
$('#btn-open').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { await loadFile(circ, f); selection.clear(); userPerDiv = null; resetSim(); fit(); commit(); } catch (err) { alert('Could not open that file: ' + err.message); }
});
const exSel = $('#examples');
EXAMPLES.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; exSel.append(o); });
exSel.addEventListener('change', () => {
  if (exSel.value === '') return;
  loadExample(EXAMPLES[+exSel.value]);
  exSel.value = '';
});
function loadExample(ex) {
  circ.load(ex.build().toJSON());
  selection.clear(); userPerDiv = null;
  resetSim(); fit(); commit();
}

// scope controls
const sTime = $('#s-time'), sV = $('#s-vdiv');
function fillSelect(sel, items) { for (const [v, l] of items) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); } }
fillSelect(sTime, [['auto', 'Auto'], ...[1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1].map((v) => [v, fmt(v, 's')])]);
fillSelect(sV, [[0, 'Auto'], ...[0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].map((v) => [v, fmt(v, 'V')])]);
function syncScopeControls() {
  sTime.value = userPerDiv ? String(userPerDiv) : 'auto';
  if (userPerDiv && sTime.value !== String(userPerDiv)) sTime.value = 'auto';
  sV.value = String(userVdiv);
}
sTime.addEventListener('change', () => {
  userPerDiv = sTime.value === 'auto' ? null : +sTime.value;
  scope.perDiv = userPerDiv ?? circ.meta.perDiv ?? scope.perDiv;
  if (!userPerDiv) markDirty();
  scope.clear();
});
sV.addEventListener('change', () => { userVdiv = +sV.value; scope.vdiv = userVdiv; });
$('#s-hold').addEventListener('click', (e) => { scope.hold = !scope.hold; e.currentTarget.classList.toggle('is-on', scope.hold); });
$('#s-clear').addEventListener('click', () => scope.clear());
$('#btn-scope').addEventListener('click', () => { $('#scopepanel').hidden = !$('#scopepanel').hidden; });

// ---- export dialog ------------------------------------------------------------------
const dlg = $('#export-dlg');
const exOpts = () => ({ values: $('#e-values').checked, bom: $('#e-bom').checked, colorWires: $('#e-color').checked });
function renderExport() {
  const pv = $('#e-preview');
  pv.className = 'dlg-preview ' + ($('#e-zoom').value === 'fit' ? 'fit' : '');
  if (!circ.components.length) { pv.innerHTML = '<div class="empty">Nothing to export yet. Add some parts first.</div>'; return; }
  pv.innerHTML = buildSchematic(circ, sim, exOpts()).svg;
}
$('#btn-export').addEventListener('click', () => {
  $('#e-title').value = circ.title || '';
  renderExport();
  dlg.showModal();
});
$('#e-close').addEventListener('click', () => dlg.close());
for (const id of ['#e-values', '#e-bom', '#e-color', '#e-zoom']) $(id).addEventListener('change', renderExport);
$('#e-title').addEventListener('input', () => { circ.title = $('#e-title').value; renderExport(); });
$('#e-title').addEventListener('change', () => commit());
$('#e-svg').addEventListener('click', () => exportSVG(circ, sim, exOpts()));
$('#e-png').addEventListener('click', () => exportPNG(circ, sim, exOpts()));
$('#e-spice').addEventListener('click', () => {
  const name = (circ.title || 'circuit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
  download(new Blob([toSpice(circ, circ.title)], { type: 'text/plain' }), `circuitwright-${name}.cir`);
});

// ---- start ------------------------------------------------------------------------------
const styleEl = document.createElement('style');
styleEl.textContent = SVG_CSS;
document.head.append(styleEl);
buildPalette();
applyView();
if (!restore(circ)) circ.load(EXAMPLES[0].build().toJSON());
undoStack.push(snapshot());
syncHistoryButtons();
requestAnimationFrame(() => { fit(); });
requestAnimationFrame(frame);
requireDisclaimer();
window.addEventListener('resize', () => { applyView(); });
