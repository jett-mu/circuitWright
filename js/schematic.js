// Place stages in columns, route nets orthogonally on unique tracks, resolve
// crossings (hop arcs) and junctions (dots), and emit an SVG string. No DOM.
import { buildCell, TECHS } from './cells.js';
import { battery, shift } from './symbols.js';

export const DISCLAIMER = 'Educational use only. Provided "as is", without warranty of any kind. Not verified or checked against real component ratings, and has no protection circuitry. Not for mains voltage, high current, batteries or any safety-critical use. Verify every design yourself before building. Use at your own risk; the author is not liable for injury, property damage or any other loss.';
const FOOT_CH = 4.9, FOOT_LH = 11;      // 8px monospace advance, line height
export function disclaimerFooter(width) {
  const per = Math.max(20, Math.floor((width - 20) / FOOT_CH)), lines = [];
  let cur = '';
  for (const w of DISCLAIMER.split(' ')) {
    if (cur && (cur + ' ' + w).length > per) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return { lines, height: 10 + lines.length * FOOT_LH, lh: FOOT_LH };
}
export const HOP_R = 5;                 // hop-over arc radius
export const MIN_GAP = 3 * HOP_R;       // 1.5 x the hop diameter: closest two wires may run
const TRACK = MIN_GAP + 1, CH_PAD = 36, ROW_GAP = 36, MARGIN = 50, TERM_W = 90, TERM_H = 24;
const EPS = 0.01;

function terminal(kind, label) {
  const mid = TERM_H / 2;
  return kind === 'in'
    ? { w: TERM_W, h: TERM_H, ins: [], out: { x: TERM_W, y: mid }, prims: [
      { t: 't', x: 50, y: mid + 4, s: label, a: 'end', b: true }, { t: 'l', x1: 56, y1: mid, x2: TERM_W, y2: mid }, { t: 'o', x: 56, y: mid, r: 3 }] }
    : { w: TERM_W, h: TERM_H, ins: [{ x: 0, y: mid }], out: null, prims: [
      { t: 'l', x1: 0, y1: mid, x2: 34, y2: mid }, { t: 'o', x: 34, y: mid, r: 3 }, { t: 't', x: 40, y: mid + 4, s: label, a: 'start', b: true }] };
}

export function layoutSchematic(nl, tech, opts = {}) {
  const names = { M: 0, Q: 0, R: 0, K: 0 };
  const rails = !!TECHS[tech].rails;
  const nodes = [];
  const nets = new Map(); // net -> {drv, sinks:[{node,pin}]}
  const netOf = (n) => { if (!nets.has(n)) nets.set(n, { drv: null, sinks: [] }); return nets.get(n); };

  // --- nodes + levels ---------------------------------------------------
  const stageOut = new Map(nl.stages.map((s) => [s.out, s]));
  const memo = new Map(), visiting = new Set();
  const level = (s) => {
    if (memo.has(s)) return memo.get(s);
    if (visiting.has(s)) return 0; // feedback edge
    visiting.add(s);
    let l = 0;
    for (const n of s.ins) { const d = stageOut.get(n); if (d) l = Math.max(l, level(d)); }
    visiting.delete(s);
    memo.set(s, l + 1);
    return l + 1;
  };
  const maxLevel = Math.max(0, ...nl.stages.map(level));

  if (rails) { // one DC source feeds every relay over real VDD / GND wires
    const b = battery(0, 0);
    const nd = { w: 90, h: 90, ins: [], out: null, prims: b.prims, col: 0, kind: 'src' };
    nodes.push(nd);
    Object.assign(netOf('VDD'), { drv: nd, port: b.plus });
    Object.assign(netOf('GND'), { drv: nd, port: b.minus });
  }
  for (const t of nl.inputs) {
    const nd = { ...terminal('in', t.label), col: 0, kind: 'in' };
    nodes.push(nd); netOf(t.net).drv = nd;
  }
  for (const s of nl.stages) {
    const cell = buildCell(tech, s.kind, names, opts);
    const nd = { ...cell, col: level(s), kind: 'stage', stage: s };
    nodes.push(nd);
    netOf(s.out).drv = nd;
    s.ins.forEach((n, pin) => {
      if (n !== '0') netOf(n).sinks.push({ node: nd, pin });
      else if (rails) netOf('GND').sinks.push({ node: nd, pin }); // tied-low input: wire to the GND rail
    });
    if (rails) {
      const k = nd.ins.length;
      nd.ins = [...nd.ins, cell.vdd, cell.gnd];
      netOf('VDD').sinks.push({ node: nd, pin: k });
      netOf('GND').sinks.push({ node: nd, pin: k + 1 });
    }
  }
  for (const t of nl.outputs) {
    const nd = { ...terminal('out', t.label), col: maxLevel + 1, kind: 'out' };
    nodes.push(nd); netOf(t.net).sinks.push({ node: nd, pin: 0 });
  }
  const ncols = maxLevel + 2;
  // inputs tied to ground (net '0') get a local ground symbol, no routing.
  const grounds = [];
  for (const nd of nodes) if (nd.stage && !rails) nd.stage.ins.forEach((n, pin) => { if (n === '0') grounds.push({ node: nd, pin }); });

  // --- classify nets: near sinks (next column) vs far sinks (need a lane) ---
  const routed = [];
  for (const [id, n] of nets) {
    if (!n.drv || !n.sinks.length) continue;
    const d = n.drv.col;
    const near = n.sinks.filter((s) => s.node.col === d + 1);
    const far = n.sinks.filter((s) => s.node.col !== d + 1);
    routed.push({ id, drv: n.drv, port: n.port, near, far, lane: far.length ? 1 : 0 });
  }
  const laneNets = routed.filter((r) => r.lane);
  laneNets.forEach((r, i) => { r.laneIdx = i; });
  const baseY = MARGIN + laneNets.length * TRACK + 30;

  // --- vertical ordering (barycenter) and stacking ----------------------
  const cols = Array.from({ length: ncols }, () => []);
  nodes.forEach((n) => cols[n.col].push(n));
  const centre = (n) => n.y + n.h / 2;
  const heights = [];
  cols.forEach((col, c) => {
    if (c > 0) {
      const pos = new Map(col.map((n, i) => [n, i]));
      const bary = (n) => {
        const ds = [];
        if (n.kind === 'stage') for (const net of n.stage.ins) { const d = nets.get(net)?.drv; if (d && d.col < c && d.y !== undefined) ds.push(centre(d)); }
        if (n.kind === 'out') for (const [, nt] of nets) if (nt.sinks.some((s) => s.node === n) && nt.drv?.y !== undefined) ds.push(centre(nt.drv));
        return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : pos.get(n) * 1e4;
      };
      col.sort((a, b) => bary(a) - bary(b));
    }
    let y = baseY;
    for (const n of col) { n.y = y; y += n.h + ROW_GAP; }
    heights.push(y - ROW_GAP - baseY);
  });
  const maxH = Math.max(0, ...heights);
  cols.forEach((col, c) => { const off = Math.round((maxH - heights[c]) / 2 / 10) * 10; col.forEach((n) => { n.y += off; }); });

  // --- trunk users per channel; channel k sits left of column k ---------
  const users = Array.from({ length: ncols + 1 }, () => []); // {net, role}
  for (const r of routed) {
    const d = r.drv.col;
    if (r.near.length || r.far.length) users[d + 1].push({ net: r, role: 'drv' });
    for (const s of new Set(r.far.map((f) => f.node.col))) users[s].push({ net: r, role: 'snk', col: s });
  }
  const portY = (nd, pin) => nd.y + nd.ins[pin].y;
  const outPort = (r) => r.port ?? r.drv.out;
  const order = new Map(); // `${k}|${net.id}|${role}` -> track index
  users.forEach((list, k) => {
    // sinks' horizontal runs (trunk -> cell) must not overlap a driver run on the same y.
    const sinkYs = (u) => (u.net.near.length && u.role === 'drv' ? u.net.near : u.net.far.filter((f) => f.node.col === u.col))
      .map((s) => portY(s.node, s.pin));
    const yOf = (u) => (u.role === 'drv' ? u.net.drv.y + outPort(u.net).y : sinkYs(u)[0] ?? 0);
    const base = [...list].sort((a, b) => yOf(a) - yOf(b));
    const before = new Map(base.map((u) => [u, new Set()]));
    for (const a of base) if (a.role === 'drv') {
      const ya = a.net.drv.y + outPort(a.net).y;
      for (const b of base) {
        if (b === a) continue;
        const ys = b.role === 'drv' ? (b.net.near.map((s) => portY(s.node, s.pin))) : sinkYs(b);
        if (ys.some((y) => Math.abs(y - ya) < MIN_GAP)) before.get(b).add(a);
      }
    }
    const done = new Set(), seq = [];
    while (seq.length < base.length) {
      const next = base.find((u) => !done.has(u) && [...before.get(u)].every((p) => done.has(p))) ?? base.find((u) => !done.has(u));
      done.add(next); seq.push(next);
    }
    seq.forEach((u, i) => order.set(`${k}|${u.net.id}|${u.role}|${u.col ?? ''}`, i));
  });

  // --- column x positions ----------------------------------------------
  const colW = cols.map((col) => Math.max(0, ...col.map((n) => n.w)));
  const chanX = []; // left edge of channel k
  const colX = [];
  let x = MARGIN;
  for (let k = 0; k < ncols; k++) {
    if (k > 0) { chanX[k] = x; x += CH_PAD * 2 + TRACK * Math.max(1, users[k].length); }
    colX[k] = x;
    x += colW[k];
  }
  const width = x + MARGIN;
  const height = baseY + maxH + MARGIN + 20;
  const trunkX = (k, id, role, col = '') => chanX[k] + CH_PAD + TRACK * (order.get(`${k}|${id}|${role}|${col}`) ?? 0);

  // --- segments ---------------------------------------------------------
  const segs = [];
  const seg = (net, x1, y1, x2, y2) => { if (Math.abs(x1 - x2) > EPS || Math.abs(y1 - y2) > EPS) segs.push({ net, x1, y1, x2, y2 }); };
  for (const r of routed) {
    const d = r.drv, xd = colX[d.col] + outPort(r).x, yd = d.y + outPort(r).y;
    const tx = trunkX(d.col + 1, r.id, 'drv');
    const laneY = r.lane ? MARGIN + 10 + r.laneIdx * TRACK : null;
    const ys = [yd, ...r.near.map((s) => portY(s.node, s.pin))];
    if (laneY !== null) ys.push(laneY);
    seg(r.id, xd, yd, tx, yd);
    seg(r.id, tx, Math.min(...ys), tx, Math.max(...ys));
    for (const s of r.near) seg(r.id, tx, portY(s.node, s.pin), colX[s.node.col], portY(s.node, s.pin));
    if (r.far.length) {
      const fx = new Map();
      for (const f of r.far) {
        const col = f.node.col;
        if (!fx.has(col)) fx.set(col, trunkX(col, r.id, 'snk', col));
        const fxx = fx.get(col), fy = portY(f.node, f.pin);
        seg(r.id, fxx, Math.min(laneY, fy), fxx, Math.max(laneY, fy));
        seg(r.id, fxx, fy, colX[col], fy);
      }
      const xs = [tx, ...fx.values()];
      seg(r.id, Math.min(...xs), laneY, Math.max(...xs), laneY);
    }
  }

  return { nodes, colX, segs, grounds, width, height, names, tech, nets: routed };
}

const isH = (s) => Math.abs(s.y1 - s.y2) < EPS;
const onSeg = (s, x, y) => (isH(s)
  ? Math.abs(s.y1 - y) < EPS && x >= Math.min(s.x1, s.x2) - EPS && x <= Math.max(s.x1, s.x2) + EPS
  : Math.abs(s.x1 - x) < EPS && y >= Math.min(s.y1, s.y2) - EPS && y <= Math.max(s.y1, s.y2) + EPS);

// Different nets sharing a line (a routing bug). Returns [] when clean.
export function findOverlaps(segs) {
  const out = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.net === b.net || isH(a) !== isH(b)) continue;
    if (isH(a) && Math.abs(a.y1 - b.y1) < EPS) {
      const lo = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2)), hi = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2));
      if (hi - lo > EPS) out.push([a, b]);
    } else if (!isH(a) && Math.abs(a.x1 - b.x1) < EPS) {
      const lo = Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2)), hi = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2));
      if (hi - lo > EPS) out.push([a, b]);
    }
  }
  return out;
}

// Wire primitives: hop arcs where different nets cross, dots at junctions.
export function wirePrims(segs) {
  const prims = [];
  const verts = segs.filter((s) => !isH(s));
  let hops = 0;
  for (const s of segs) {
    if (!isH(s)) { prims.push({ t: 'l', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, w: true, net: s.net }); continue; }
    const xa = Math.min(s.x1, s.x2), xb = Math.max(s.x1, s.x2), y = s.y1;
    const cuts = [...new Set(verts.filter((v) => v.net !== s.net && v.x1 > xa + MIN_GAP / 2 && v.x1 < xb - MIN_GAP / 2
      && y > Math.min(v.y1, v.y2) + EPS && y < Math.max(v.y1, v.y2) - EPS).map((v) => v.x1))].sort((p, q) => p - q);
    let cur = xa;
    for (const cx of cuts) {
      if (cx - HOP_R > cur) prims.push({ t: 'l', x1: cur, y1: y, x2: cx - HOP_R, y2: y, w: true, net: s.net });
      prims.push({ t: 'hop', x: cx, y, r: HOP_R, w: true, net: s.net });
      cur = cx + HOP_R; hops++;
    }
    prims.push({ t: 'l', x1: cur, y1: y, x2: xb, y2: y, w: true, net: s.net });
  }
  // Junction dots: a point of one net where >=3 distinct directions leave.
  const byNet = new Map();
  for (const s of segs) { if (!byNet.has(s.net)) byNet.set(s.net, []); byNet.get(s.net).push(s); }
  const seen = new Set();
  for (const list of byNet.values()) {
    const pts = [];
    for (const s of list) pts.push([s.x1, s.y1], [s.x2, s.y2]);
    for (const h of list) if (isH(h)) for (const v of list) if (!isH(v)) pts.push([v.x1, h.y1]);
    for (const [px, py] of pts) {
      const k = `${Math.round(px)},${Math.round(py)}`;
      if (seen.has(k)) continue;
      const dirs = new Set();
      for (const s of list) {
        if (!onSeg(s, px, py)) continue;
        if (isH(s)) {
          if (Math.min(s.x1, s.x2) < px - EPS) dirs.add('L');
          if (Math.max(s.x1, s.x2) > px + EPS) dirs.add('R');
        } else {
          if (Math.min(s.y1, s.y2) < py - EPS) dirs.add('U');
          if (Math.max(s.y1, s.y2) > py + EPS) dirs.add('D');
        }
      }
      if (dirs.size >= 3) { seen.add(k); prims.push({ t: 'd', x: px, y: py, net: list[0].net }); }
    }
  }
  return { prims, hops };
}

const CSS = `.s,.w{stroke:#111827;stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round}
.f{fill:#111827}.t{font:600 10px ui-monospace,Menlo,Consolas,monospace;fill:#374151}.b{font-size:12px;fill:#111827}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const f = (n) => Math.round(n * 100) / 100;

const RAIL_COLORS = { VDD: '#c62828', GND: '#1565c0' };
function primToSvg(p, colors) {
  const cls = p.w ? 'w' : 's';
  const col = colors && RAIL_COLORS[p.net];
  const svg = primSvg(p, cls);
  if (!col) return svg;
  return svg.replace(/^<(\w+)/, p.t === 'd' || p.t === 't' ? `<$1 style="fill:${col}"` : `<$1 style="stroke:${col}"`);
}

function primSvg(p, cls) {
  switch (p.t) {
    case 'l': return `<line class="${cls}" x1="${f(p.x1)}" y1="${f(p.y1)}" x2="${f(p.x2)}" y2="${f(p.y2)}"${p.dash ? ' stroke-dasharray="3 3"' : ''}/>`;
    case 'o': return `<circle class="s" cx="${f(p.x)}" cy="${f(p.y)}" r="${p.r}" ${p.r > 10 ? 'stroke-width="1"' : ''}/>`;
    case 'd': return `<circle class="f" cx="${f(p.x)}" cy="${f(p.y)}" r="3.2"/>`;
    case 'hop': return `<path class="${cls}" d="M${f(p.x - p.r)},${f(p.y)} A${p.r},${p.r} 0 0 1 ${f(p.x + p.r)},${f(p.y)}"/>`;
    case 'poly': return `<polygon class="${p.fill ? 'f' : 's'}" points="${p.pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>`;
    case 't': return `<text class="t${p.b ? ' b' : ''}" x="${f(p.x)}" y="${f(p.y)}" text-anchor="${p.a}">${esc(p.s)}</text>`;
    default: return '';
  }
}

export function renderSchematic(nl, tech = 'cmos', opts = {}) {
  const L = layoutSchematic(nl, tech, opts);
  const prims = [];
  for (const n of L.nodes) prims.push(...shift(n.prims, L.colX[n.col], n.y));
  // ground ties for unconnected inputs
  for (const g of L.grounds) {
    const x = L.colX[g.node.col], y = g.node.y + g.node.ins[g.pin].y;
    prims.push({ t: 'l', x1: x - 14, y1: y, x2: x, y2: y, w: true, net: 'GND' }, { t: 'l', x1: x - 14, y1: y, x2: x - 14, y2: y + 6, net: 'GND' },
      { t: 'l', x1: x - 22, y1: y + 6, x2: x - 6, y2: y + 6, net: 'GND' }, { t: 'l', x1: x - 19, y1: y + 9, x2: x - 9, y2: y + 9, net: 'GND' }, { t: 'l', x1: x - 16, y1: y + 12, x2: x - 12, y2: y + 12, net: 'GND' });
  }
  const wires = wirePrims(L.segs);
  prims.push(...wires.prims);

  const mos = L.nodes.reduce((a, n) => a + (n.mos ?? 0), 0), bjt = L.nodes.reduce((a, n) => a + (n.bjt ?? 0), 0);
  const res = L.nodes.reduce((a, n) => a + (n.res ?? 0), 0);
  const relays = L.nodes.reduce((a, n) => a + (n.relays ?? 0), 0);
  const diodes = L.nodes.reduce((a, n) => a + (n.diodes ?? 0), 0);
  const techW = Math.max(160, 40 + TECHS[tech].label.length * 7);
  const cols = [['TECHNOLOGY', TECHS[tech].label, techW],
    ...(tech === 'relay' ? [['RELAYS', String(relays), 90], ...(opts.diode ? [['DIODES', String(diodes), 90]] : []), ['SUPPLY', 'DC +V', 90]] : [['TRANSISTORS', String(mos + bjt), 110]]),
    ...(tech === 'bjt' ? [['RESISTORS', String(res), 100]] : []), ['STAGES', String(nl.stages.length), 80], ['DATE', opts.date ?? new Date().toISOString().slice(0, 10), 100]];
  const tbW = cols.reduce((a, c) => a + c[2], 0), tbH = 66;
  const W = Math.max(L.width, tbW + 60);
  const foot = disclaimerFooter(W - 20), H = L.height + tbH + foot.height;
  const title = opts.title ?? `GATEWRIGHT — ${tech === 'relay' ? 'RELAY' : 'TRANSISTOR'}-LEVEL SCHEMATIC`;
  const tx = W - 10 - tbW, ty = H - 10 - foot.height - tbH, fy = H - 10 - foot.height;
  let cx = tx, cells = '';
  for (const [label, value, w] of cols) {
    if (cx > tx) cells += `<line x1="${cx}" y1="${ty + 26}" x2="${cx}" y2="${ty + tbH}" stroke="#111827"/>\n`;
    cells += `<text class="t" x="${cx + 8}" y="${ty + 39}" fill="#6b7280">${esc(label)}</text><text class="t b" x="${cx + 8}" y="${ty + 57}">${esc(value)}</text>\n`;
    cx += w;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>${CSS}</style>
<rect width="${W}" height="${H}" fill="#fff"/>
<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="#111827" stroke-width="1.5"/>
${prims.map((p) => primToSvg(p, opts.color)).join('\n')}
<rect x="${tx}" y="${ty}" width="${tbW}" height="${tbH}" fill="#fff" stroke="#111827" stroke-width="1.5"/>
<line x1="${tx}" y1="${ty + 26}" x2="${tx + tbW}" y2="${ty + 26}" stroke="#111827"/>
<line x1="${tx}" y1="${ty + 44}" x2="${tx + tbW}" y2="${ty + 44}" stroke="#9ca3af"/>
<text class="t b" x="${tx + 10}" y="${ty + 18}" font-weight="700">${esc(title)}</text>
<line x1="10" y1="${fy}" x2="${W - 10}" y2="${fy}" stroke="#111827"/>
${foot.lines.map((ln, i) => `<text x="20" y="${fy + 14 + i * foot.lh}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="8" fill="#6b7280">${esc(ln)}</text>`).join('\n')}
${cells}</svg>`;
  return { svg, width: W, height: H, segs: L.segs, hops: wires.hops, transistors: mos + bjt, stages: nl.stages.length, relays };
}
