// Scene: draws a Circuit into an SVG group, and repaints the live (simulated) bits per frame.
// Used by the editor canvas, the palette previews and the schematic exporter.
import { DEFS, compBox, valueText, fmt } from './model.js';
import { el, SYMBOLS } from './symbols.js';

export { el };

export const SVG_CSS = `
.sym{fill:none;stroke:var(--ink);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.sym.symb{fill:var(--body)}
.sym.thin{stroke-width:1.2}
.sym.thick{stroke-width:3.2;stroke-linecap:butt}
.sym.dash{stroke-dasharray:3 3;stroke-width:1.2}
.symf{fill:var(--ink);stroke:none}
.symt{fill:var(--ink);font:600 11px 'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;text-anchor:middle;pointer-events:none;user-select:none}
.symt.big{font-size:14px}.symt.tiny{font-size:7.5px;font-weight:500;letter-spacing:.03em}
.glow{stroke:none;fill:transparent;opacity:0;pointer-events:none}
.part.sel .sym{stroke:var(--accent)}.part.sel .symf{fill:var(--accent)}
.probedot{stroke:var(--ink);fill:var(--accent)}
.wire{fill:none;stroke:var(--wire0,#7C7F80);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.wirehit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke;cursor:pointer}
.wiresel{fill:none;stroke:var(--accent);stroke-width:8;opacity:.28;stroke-linecap:round;stroke-linejoin:round}
.wire.ghost{stroke:var(--accent);stroke-dasharray:6 5;pointer-events:none}
.jdot{fill:var(--wire0,#7C7F80);stroke:none}
.pin{fill:var(--body);stroke:var(--pin,#B5573F);stroke-width:1.6}
.pin.on{fill:var(--wire0,#7C7F80);stroke:none}
.pinhit{fill:transparent;cursor:crosshair}
.pinhit:hover + .pin,.pin.hot{stroke:var(--accent);stroke-width:2.4}
.hit{fill:transparent;stroke:none;cursor:move}
.selbox{fill:none;stroke:var(--accent);stroke-width:1.2;stroke-dasharray:5 4;pointer-events:none}
.flow{fill:none;stroke:var(--flow,#46647F);stroke-width:3.2;stroke-linecap:round;stroke-dasharray:.1 9;opacity:0;pointer-events:none}
.lbl{fill:var(--ink);font:600 11px 'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;pointer-events:none;user-select:none;paint-order:stroke;stroke:var(--halo,#fff);stroke-width:3.5px;stroke-linejoin:round}
.lbl.val{fill:var(--dim,#7C7F80);font-weight:500;font-size:10px}
.lbl.live{fill:var(--accent);font-weight:600}
.lbl.net{fill:var(--accent);font-size:9.5px}
.marquee{fill:var(--accent);fill-opacity:.08;stroke:var(--accent);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke;pointer-events:none}
`;

const key = (p) => p.x + ',' + p.y;
export const CHANNEL_COLORS = ['#b5573f', '#3f7fb5', '#5e8c6a', '#8466a0', '#c49a45', '#2f8f9d', '#a05a7a', '#6b7a3a'];

// Neutral grey for 0 V, warm for positive, cool for negative.
const NEU = [124, 127, 128], POS = [196, 78, 48], NEG = [52, 104, 168];
export function voltColor(v, vref) {
  const t = Math.max(-1, Math.min(1, v / vref));
  const tgt = t >= 0 ? POS : NEG, a = Math.abs(t) ** 0.7;
  const c = NEU.map((n, i) => Math.round(n + (tgt[i] - n) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function hopPath(pts, hopsFor) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const hs = hopsFor(a, b);
    if (hs.length) {
      const dir = Math.sign(b.x - a.x);
      for (const x of hs) d += `L${x - 5 * dir},${a.y}A5,5 0 0 ${dir > 0 ? 1 : 0} ${x + 5 * dir},${a.y}`;
    }
    d += `L${b.x},${b.y}`;
  }
  return d;
}

export class Scene {
  constructor(root, opts = {}) {
    this.root = root;
    this.interactive = opts.interactive !== false;
    this.labels = opts.labels !== false;
    this.parts = new Map();   // comp id -> {g, update, flow, live, comp}
    this.wires = new Map();   // wire id -> {path, nets}
    this.phase = 0;
  }

  build(circ, nl, opts = {}) {
    const sel = opts.selected || new Set();
    const root = this.root;
    root.replaceChildren();
    this.parts.clear(); this.wires.clear();
    this.circ = circ; this.nl = nl;
    const gW = el('g'), gJ = el('g'), gP = el('g'), gPins = el('g'), gL = el('g'), gSel = el('g');
    root.append(gW, gJ, gP, gPins, gL, gSel);

    // ---- wires with hop-overs
    const paths = new Map();
    const H = [], V = [];
    for (const w of circ.wires) {
      const pts = circ.wirePath(w);
      paths.set(w.id, pts);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (a.y === b.y && a.x !== b.x) H.push({ w: w.id, y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
        else if (a.x === b.x && a.y !== b.y) V.push({ w: w.id, x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
      }
    }
    const hopsFor = (a, b) => {
      if (a.y !== b.y || a.x === b.x) return [];
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const xs = V.filter((v) => v.x > x0 + 7 && v.x < x1 - 7 && a.y > v.y0 && a.y < v.y1).map((v) => v.x).sort((p, q) => p - q);
      const out = [];
      for (const x of xs) if (!out.length || x - out[out.length - 1] > 12) out.push(x);
      return b.x > a.x ? out : out.reverse();
    };
    for (const w of circ.wires) {
      const pts = paths.get(w.id);
      const d = hopPath(pts, hopsFor);
      const g = el('g', { 'data-wire': w.id });
      if (sel.has('w' + w.id)) g.append(el('path', { d, class: 'wiresel' }));
      const path = el('path', { d, class: 'wire' });
      g.append(path);
      if (this.interactive) g.append(el('path', { d, class: 'wirehit', 'data-wire': w.id }));
      gW.append(g);
      this.wires.set(w.id, { path, net: nl.wireNet.get(w.id) });
    }

    // ---- junction dots
    const connected = new Set();
    for (const pts of paths.values()) for (const p of pts) connected.add(key(p));
    const deg = new Map();
    const bump = (p, n = 1) => deg.set(key(p), (deg.get(key(p)) || 0) + n);
    const segs = [];
    for (const pts of paths.values()) for (let i = 1; i < pts.length; i++) { bump(pts[i - 1]); bump(pts[i]); segs.push([pts[i - 1], pts[i]]); }
    const pinKeys = new Set();
    for (const c of circ.components) DEFS[c.type].pins.forEach((_, i) => { const p = circ.pinPos(c, i); bump(p); pinKeys.add(key(p)); });
    const terms = [];
    for (const pts of paths.values()) terms.push(pts[0], pts[pts.length - 1]);
    for (const c of circ.components) DEFS[c.type].pins.forEach((_, i) => terms.push(circ.pinPos(c, i)));
    for (const p of terms) {
      for (const [a, b] of segs) {
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (cross) continue;
        const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y), len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        if (len2 && dot > 0 && dot < len2) { bump(p, 2); connected.add(key(p)); break; }
      }
    }
    this.junctions = [];
    for (const [k, n] of deg) {
      if (n >= 3 && !pinKeys.has(k) || n >= 4) {
        const [x, y] = k.split(',').map(Number);
        const dotEl = el('circle', { cx: x, cy: y, r: 3.6, class: 'jdot' });
        gJ.append(dotEl);
        let net = null;
        for (const [wid, pts] of paths) if (pts.some((p) => p.x === x && p.y === y)) { net = nl.wireNet.get(wid); break; }
        this.junctions.push({ el: dotEl, x, y, net });
      }
    }

    // ---- parts
    for (const c of circ.components) {
      const def = DEFS[c.type];
      const g = el('g', { class: 'part' + (sel.has('c' + c.id) ? ' sel' : ''), 'data-comp': c.id,
        transform: `translate(${c.x} ${c.y}) rotate(${c.rot * 90}) scale(${c.flip ? -1 : 1} 1)` });
      const [x0, y0, x1, y1] = def.box;
      if (this.interactive) g.append(el('rect', { class: 'hit', x: x0, y: y0, width: x1 - x0, height: y1 - y0, 'data-comp': c.id }));
      const sg = el('g');
      g.append(sg);
      const update = SYMBOLS[c.type](sg, c);
      const rec = { g, update, comp: c, flow: null, live: null };
      if (def.body && def.pins.length === 2) {
        // Conduction animation runs along both leads, a -> b.
        const [, ax, ay] = def.pins[0], [, bx, by] = def.pins[1];
        const len = Math.hypot(ax, ay) || 1, ux = ax / len, uy = ay / len;
        const fa = el('line', { class: 'flow', x1: ax, y1: ay, x2: ux * def.body, y2: uy * def.body });
        const fb = el('line', { class: 'flow', x1: -ux * def.body, y1: -uy * def.body, x2: bx, y2: by });
        g.append(fa, fb);
        rec.flow = [fa, fb];
      }
      gP.append(g);
      this.parts.set(c.id, rec);
      if (sel.has('c' + c.id)) {
        const b = compBox(c);
        gSel.append(el('rect', { class: 'selbox', x: b.x0 - 4, y: b.y0 - 4, width: b.x1 - b.x0 + 8, height: b.y1 - b.y0 + 8 }));
      }
      // pins
      def.pins.forEach((_, i) => {
        const p = circ.pinPos(c, i);
        if (this.interactive) gPins.append(el('circle', { class: 'pinhit', cx: p.x, cy: p.y, r: 8, 'data-pin': c.id + ':' + i }));
        gPins.append(el('circle', { class: 'pin' + (connected.has(key(p)) ? ' on' : ''), cx: p.x, cy: p.y, r: connected.has(key(p)) ? 2.4 : 3.2, 'pointer-events': 'none' }));
      });
    }
    if (this.labels) this.placeLabels(circ, paths, gL);
    this.chanIndex = new Map();
    nl.probes.forEach((p, i) => this.chanIndex.set(p.id, i));
    // Static first paint (tidy defaults)
    this.paint(null, opts);
  }

  // Name and value text for every part, placed where it does not hit parts, wires or other labels.
  placeLabels(circ, paths, gL) {
    const CW = 6.6, LH = 12, PAD = 3;
    this.labelRects = [];
    const obst = [];                       // axis aligned rects
    for (const c of circ.components) { const b = compBox(c); obst.push([b.x0 - 2, b.y0 - 2, b.x1 + 2, b.y1 + 2]); }
    for (const pts of paths.values()) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        obst.push([Math.min(a.x, b.x) - 3, Math.min(a.y, b.y) - 3, Math.max(a.x, b.x) + 3, Math.max(a.y, b.y) + 3]);
      }
    }
    const hit = (r) => obst.reduce((n, o) => n + (r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1] ? 1 : 0), 0);
    const meter = (t) => t === 'voltmeter' || t === 'ammeter' || t === 'probe';
    for (const c of circ.components) {
      if (c.type === 'ground' || c.type === 'netlabel' || c.type === 'vcc') continue;
      const rec = this.parts.get(c.id), b = compBox(c), val = valueText(c);
      const lines = [{ s: c.label, cls: 'lbl' }];
      if (val) lines.push({ s: val, cls: 'lbl val' });
      if (meter(c.type)) lines.push({ s: '00.0mV', cls: 'lbl live', live: true });
      const w = Math.max(...lines.map((l) => l.s.length)) * CW, h = lines.length * LH;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const wide = b.x1 - b.x0 >= b.y1 - b.y0;
      const cand = [];
      const along = Math.max(w, h) / 2;
      // Rings of increasing distance from the part, sliding along each side.
      for (const d of [0, 14, 30]) {
        const slide = [0, -along, along, -2 * along, 2 * along];
        const sides = {
          above: (o) => ({ x0: cx - w / 2 + o, y0: b.y0 - PAD - d - h, anchor: 'middle', pen: Math.abs(o) }),
          below: (o) => ({ x0: cx - w / 2 + o, y0: b.y1 + PAD + d, anchor: 'middle', pen: Math.abs(o) }),
          right: (o) => ({ x0: b.x1 + 6 + d, y0: cy - h / 2 + o, anchor: 'start', pen: Math.abs(o) }),
          left: (o) => ({ x0: b.x0 - 6 - d - w, y0: cy - h / 2 + o, anchor: 'end', pen: Math.abs(o) }),
        };
        const order = wide ? ['above', 'below', 'right', 'left'] : ['right', 'left', 'above', 'below'];
        for (const sd of order) for (const o of slide) cand.push({ ...sides[sd](o), d });
      }
      let best = null, bs = Infinity;
      for (const k of cand) {
        const r = [k.x0, k.y0, k.x0 + w, k.y0 + h];
        const score = hit(r) * 100 + k.d * 0.5 + k.pen * 0.05;
        if (score < bs) { bs = score; best = k; }
      }
      const x = best.anchor === 'middle' ? best.x0 + w / 2 : best.anchor === 'start' ? best.x0 : best.x0 + w;
      lines.forEach((l, i) => {
        const t = el('text', { class: l.cls, x, y: best.y0 + (i + 1) * LH - 3, 'text-anchor': best.anchor });
        t.textContent = l.live ? '' : l.s;
        gL.append(t);
        if (l.live) rec.live = t;
      });
      obst.push([best.x0 - 1, best.y0, best.x0 + w + 1, best.y0 + h]);
      this.labelRects.push({ x0: best.x0, y0: best.y0, x1: best.x0 + w, y1: best.y0 + h });
    }
  }

  // Per-frame update from the simulator (sim may be null for an idle circuit).
  paint(sim, opts = {}) {
    const nl = this.nl;
    let vref = 1;
    if (sim) for (let i = 0; i < sim.nv; i++) vref = Math.max(vref, Math.abs(sim.x[i]));
    const colour = opts.colorWires !== false;
    for (const w of this.wires.values()) {
      const v = sim && colour ? sim.v(w.net) : null;
      w.path.style.stroke = v === null ? '' : voltColor(v, vref);
    }
    for (const j of this.junctions) j.el.style.fill = sim && colour && j.net !== null ? voltColor(sim.v(j.net), vref) : '';
    this.phase = (this.phase + 1.2) % 1e6;
    for (const rec of this.parts.values()) {
      const c = rec.comp, info = sim ? sim.info(c.id) : null;
      if (rec.update) {
        if (c.type === 'probe') rec.update({ color: CHANNEL_COLORS[this.chanIndex.get(c.id) % CHANNEL_COLORS.length] });
        else rec.update(info ? { ...info, i: info.i } : null);
      }
      if (rec.flow) {
        let i = info?.i ?? 0;
        if (c.type === 'vdc' || c.type === 'vac' || c.type === 'battery') i = -i;
        const mag = Math.abs(i);
        const on = sim && mag > 1e-6;
        const op = on ? Math.min(1, 0.35 + Math.log10(mag / 1e-6) / 6) : 0;
        const off = -this.phase * Math.sign(i || 1);
        for (const f of rec.flow) { f.style.opacity = op; f.setAttribute('stroke-dashoffset', off); }
      }
      if (rec.live) {
        let s = '';
        if (sim) {
          if (c.type === 'voltmeter') s = fmt(info?.v ?? 0, 'V');
          else if (c.type === 'ammeter') s = fmt(info?.i ?? 0, 'A');
          else if (c.type === 'probe') s = fmt(sim.v(nl.pinNet.get(c.id + ':0')), 'V');
        }
        rec.live.textContent = s;
      }
    }
  }
}

// A finished, static drawing of the circuit (for export). Returns the group.
export function drawStatic(circ, nl, sim, opts = {}) {
  const g = el('g');
  const sc = new Scene(g, { interactive: false, labels: opts.labels !== false });
  sc.build(circ, nl, {});
  if (sim) sc.paint(sim, { colorWires: opts.colorWires });
  for (const f of g.querySelectorAll('.flow')) f.remove();
  g.labelRects = sc.labelRects || [];
  return g;
}
