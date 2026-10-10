// Professional schematic export: clean white sheet, border, title block.
import { dims } from './model.js';
import { el, renderCircuit, SVG_CSS } from './render.js';
import { buildNetlist } from './netlist.js';
import { renderSchematic, wirePrims, disclaimerFooter } from './schematic.js';
import { exportView } from './exportview.js';
import { routeOrtho } from './orthowires.js';

const PRINT_VARS = '--ink:#111827;--body:#ffffff;--off:#9ca3af;--on:#15803d;--dim:#6b7280;--accent:#2563eb;--bulbOff:#ffffff;--bulbOn:#facc15;';

const SPREAD_X = 1.6, SPREAD_Y = 1.25;
export const DEFAULT_EXPORT = { wireStyle: 'curve', subInputs: false, subOutputs: false, deactivateInputs: false };

// Draw routed wire primitives (hops, junction dots) as SVG, coloured by signal.
function drawWires(g, segs, ends, out) {
  const { prims } = wirePrims(segs);
  const cls = (net) => 'wire' + (out[net] ? ' on' : '');
  for (const p of prims) {
    if (p.t === 'l') g.append(el('line', { class: cls(p.net), x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 }));
    else if (p.t === 'hop') g.append(el('path', { class: cls(p.net), d: `M${p.x - p.r},${p.y} A${p.r},${p.r} 0 0 1 ${p.x + p.r},${p.y}` }));
    else if (p.t === 'd') g.append(el('circle', { class: 'jdot', cx: p.x, cy: p.y, r: 3.2 }));
  }
  for (const e of ends) g.append(el('rect', { class: 'endpt' + (out[e.net] ? ' on' : ''), x: e.x - 4, y: e.y - 4, width: 8, height: 8 }));
}

export function buildSchematic(source, sourceOut, opts = {}) {
  const o = { ...DEFAULT_EXPORT, ...opts };
  const { circ, out } = exportView(source, sourceOut, o);
  // Straight wires need channel room for separate tracks: nudge parts apart a little.
  if (o.wireStyle === 'ortho') for (const c of circ.components) { c.x = Math.round(c.x * SPREAD_X); c.y = Math.round(c.y * SPREAD_Y); }
  const routed = o.wireStyle === 'ortho' ? routeOrtho(circ) : null;

  let minX = 0, minY = 0, maxX = 360, maxY = 140;
  if (circ.components.length) {
    const xs = [], ys = [];
    for (const c of circ.components) { const d = dims(c); xs.push(c.x, c.x + d.w); ys.push(c.y, c.y + d.h); }
    for (const s of routed?.segs ?? []) { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
    minX = Math.min(...xs) - 50; minY = Math.min(...ys) - 50;
    maxX = Math.max(...xs) + 50; maxY = Math.max(...ys) + 50;
  }
  const tbW = 330, tbH = 66;
  maxX = Math.max(maxX, minX + tbW + 40);
  const foot = disclaimerFooter(maxX - minX - 16);
  maxY += tbH + 10 + foot.height;
  const W = maxX - minX, H = maxY - minY;

  const svg = el('svg', { xmlns: 'http://www.w3.org/2000/svg', width: W, height: H, viewBox: `${minX} ${minY} ${W} ${H}`, style: PRINT_VARS });
  svg.append(el('style', {}, []));
  svg.lastChild.textContent = SVG_CSS;
  svg.append(el('rect', { x: minX, y: minY, width: W, height: H, fill: '#fff' }));
  svg.append(el('rect', { x: minX + 8, y: minY + 8, width: W - 16, height: H - 16, fill: 'none', stroke: '#111827', 'stroke-width': 1.5 }));
  const g = el('g');
  if (routed) drawWires(g, routed.segs, routed.ends, out);
  renderCircuit(g, circ, out, { interactive: false, noWires: !!routed });
  svg.append(g);

  const tx = maxX - 8 - tbW, ty = maxY - 8 - foot.height - tbH, fy = maxY - 8 - foot.height;
  const t = (s, x, y, size, weight = 600, fill = '#111827') => {
    const e = el('text', { x: tx + x, y: ty + y, 'font-family': 'ui-monospace,Menlo,Consolas,monospace', 'font-size': size, 'font-weight': weight, fill });
    e.textContent = s; return e;
  };
  // Title block as a small table: header row, label row, value row.
  svg.append(el('rect', { x: tx, y: ty, width: tbW, height: tbH, fill: '#fff', stroke: '#111827', 'stroke-width': 1.5 }));
  svg.append(el('line', { x1: tx, y1: ty + 26, x2: tx + tbW, y2: ty + 26, stroke: '#111827' }));
  svg.append(el('line', { x1: tx, y1: ty + 44, x2: tx + tbW, y2: ty + 44, stroke: '#9ca3af' }));
  svg.append(t('GATEWRIGHT — LOGIC SCHEMATIC', 10, 18, 12, 700));
  const cols = [['DATE', new Date().toISOString().slice(0, 10), 130], ['PARTS', String(circ.components.length), 100], ['WIRES', String(circ.wires.length), 100]];
  let off = 0;
  for (const [label, value, w] of cols) {
    if (off) svg.append(el('line', { x1: tx + off, y1: ty + 26, x2: tx + off, y2: ty + tbH, stroke: '#111827' }));
    svg.append(t(label, off + 8, 39, 9, 600, '#6b7280'));
    svg.append(t(value, off + 8, 57, 11, 700));
    off += w;
  }
  // Full-width disclaimer footer under the title block.
  svg.append(el('line', { x1: minX + 8, y1: fy, x2: maxX - 8, y2: fy, stroke: '#111827', 'stroke-width': 1.5 }));
  foot.lines.forEach((ln, i) => {
    const e = el('text', { x: minX + 18, y: fy + 14 + i * foot.lh, 'font-family': 'ui-monospace,Menlo,Consolas,monospace', 'font-size': 8, 'font-weight': 600, fill: '#6b7280' });
    e.textContent = ln; svg.append(e);
  });
  return { svg: new XMLSerializer().serializeToString(svg), width: W, height: H, segs: routed?.segs ?? [] };
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportSVG(circ, out, opts) {
  const { svg } = buildSchematic(circ, out, opts);
  download(new Blob([svg], { type: 'image/svg+xml' }), 'gatewright-schematic.svg');
}

function rasterize(svg, width, height, name, scale = 2) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    // Browsers cap canvas size; keep huge schematics inside ~16k px.
    const k = Math.min(scale, 16000 / Math.max(width, height));
    cv.width = Math.round(width * k);
    cv.height = Math.round(height * k);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => download(b, name), 'image/png');
  };
  img.src = url;
}

export function exportPNG(circ, out, opts, scale = 2) {
  const { svg, width, height } = buildSchematic(circ, out, opts);
  rasterize(svg, width, height, 'gatewright-schematic.png', scale);
}

// ---- transistor-level circuit export ------------------------------------
export function circuitSchematic(circ, tech, opts = {}) {
  const nl = buildNetlist(circ);
  return { nl, ...renderSchematic(nl, tech, opts) };
}

export function exportCircuitSVG(circ, tech, opts) {
  download(new Blob([circuitSchematic(circ, tech, opts).svg], { type: 'image/svg+xml' }), `gatewright-circuit-${tech}.svg`);
}

export function exportCircuitPNG(circ, tech, opts) {
  const { svg, width, height } = circuitSchematic(circ, tech, opts);
  rasterize(svg, width, height, `gatewright-circuit-${tech}.png`, 2);
}
