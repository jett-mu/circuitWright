// Electronic symbols as plain scene primitives (no DOM).
//   {t:'l',x1,y1,x2,y2}  line        {t:'poly',pts,closed,fill}  polygon/polyline
//   {t:'o',x,y,r}        circle      {t:'d',x,y}  junction dot
//   {t:'hop',x,y,r}      hop arc     {t:'t',x,y,s,a}  text
const l = (x1, y1, x2, y2) => ({ t: 'l', x1, y1, x2, y2 });
export const text = (s, x, y, a = 'start') => ({ t: 't', x, y, s, a });
export const dot = (x, y) => ({ t: 'd', x, y });
export const hop = (x, y, r = 5) => ({ t: 'hop', x, y, r });
export const line = l;

// MOSFET. gate lead on the left (or right when mirrored); drain/source vertical.
// PMOS: bubble on the gate, arrow out, body tied to the top (source) terminal.
export function mos(x, y, { p = false, mir = false, label = '' } = {}) {
  const s = mir ? -1 : 1, X = (d) => x + s * d;
  const o = [];
  if (p) { o.push(l(X(-30), y, X(-21), y), { t: 'o', x: X(-18), y, r: 3 }); } else o.push(l(X(-30), y, X(-12), y));
  o.push(
    l(X(-12), y - 10, X(-12), y + 10),
    l(X(-7), y - 12, X(-7), y - 6), l(X(-7), y - 3, X(-7), y + 3), l(X(-7), y + 6, X(-7), y + 12),
    l(X(-7), y - 9, X(8), y - 9), l(X(8), y - 9, X(8), y - 20),
    l(X(-7), y + 9, X(8), y + 9), l(X(8), y + 9, X(8), y + 20),
    l(X(-7), y, X(8), y), l(X(8), y, X(8), y + (p ? -9 : 9)),
  );
  o.push({ t: 'poly', fill: true, closed: true, pts: p
    ? [[X(-6), y - 3], [X(-6), y + 3], [X(0), y]]
    : [[X(-7), y], [X(-1), y - 3], [X(-1), y + 3]] });
  if (label) o.push(text(label, X(8) + s * 6, y + 3, s > 0 ? 'start' : 'end'));
  return { prims: o, g: { x: X(-30), y }, top: { x: X(8), y: y - 20 }, bot: { x: X(8), y: y + 20 } };
}

// NPN BJT: base left, collector up, emitter down (arrow out).
export function npn(x, y, label = '') {
  const o = [
    l(x - 30, y, x - 10, y), l(x - 10, y - 12, x - 10, y + 12),
    l(x - 10, y - 5, x + 8, y - 14), l(x + 8, y - 14, x + 8, y - 20),
    l(x - 10, y + 5, x + 8, y + 14), l(x + 8, y + 14, x + 8, y + 20),
    { t: 'o', x: x - 1, y, r: 17 },
    { t: 'poly', fill: true, closed: true, pts: [[x + 7, y + 13.5], [x - 0.5, y + 12.9], [x + 2, y + 7.9]] },
  ];
  if (label) o.push(text(label, x + 20, y + 4));
  return { prims: o, b: { x: x - 30, y }, c: { x: x + 8, y: y - 20 }, e: { x: x + 8, y: y + 20 } };
}

// IEC box resistor, 40 long. vertical: a=top b=bottom; else a=left b=right.
export function resistor(cx, cy, { vertical = true, label = '' } = {}) {
  if (vertical) {
    return { prims: [l(cx, cy - 20, cx, cy - 12), l(cx, cy + 12, cx, cy + 20),
      { t: 'poly', closed: true, pts: [[cx - 4, cy - 12], [cx + 4, cy - 12], [cx + 4, cy + 12], [cx - 4, cy + 12]] },
      ...(label ? [text(label, cx + 8, cy + 3)] : [])],
    a: { x: cx, y: cy - 20 }, b: { x: cx, y: cy + 20 } };
  }
  return { prims: [l(cx - 20, cy, cx - 12, cy), l(cx + 12, cy, cx + 20, cy),
    { t: 'poly', closed: true, pts: [[cx - 12, cy - 4], [cx + 12, cy - 4], [cx + 12, cy + 4], [cx - 12, cy + 4]] },
    ...(label ? [text(label, cx, cy - 8, 'middle')] : [])],
  a: { x: cx - 20, y: cy }, b: { x: cx + 20, y: cy } };
}

// 5-terminal changeover relay, drawn unpowered (4-5 closed). Top-left at (x, y), 80 x 40.
// Coil pins 1, 2 on the left; contacts 3 (normally open), 4 (common), 5 (normally closed) on the right.
export function relay(x, y, label = '') {
  const o = [
    l(x, y + 10, x + 14, y + 10), l(x, y + 30, x + 14, y + 30),
    { t: 'poly', closed: true, pts: [[x + 14, y + 4], [x + 30, y + 4], [x + 30, y + 36], [x + 14, y + 36]] },
    { ...l(x + 30, y + 20, x + 66, y + 27), dash: true },
    l(x + 60, y + 4, x + 80, y + 4), { t: 'o', x: x + 60, y: y + 4, r: 2 },
    l(x + 60, y + 36, x + 80, y + 36), { t: 'o', x: x + 60, y: y + 36, r: 2 },
    l(x + 72, y + 20, x + 80, y + 20), { t: 'o', x: x + 72, y: y + 20, r: 2 },
    l(x + 72, y + 20, x + 61, y + 34),
    text('1', x + 4, y + 7), text('2', x + 4, y + 27),
    text('3', x + 78, y + 1, 'end'), text('4', x + 78, y + 17, 'end'), text('5', x + 78, y + 33, 'end'),
  ];
  if (label) o.push(text(label, x + 22, y - 4, 'middle'));
  return { prims: o, p1: { x, y: y + 10 }, p2: { x, y: y + 30 }, p3: { x: x + 80, y: y + 4 }, p4: { x: x + 80, y: y + 20 }, p5: { x: x + 80, y: y + 36 } };
}

// Flyback diode, vertical, 30 tall: cathode (bar) at the top, anode at the bottom.
export function diode(x, y) {
  return [l(x, y, x, y + 6), l(x - 5, y + 6, x + 5, y + 6),
    { t: 'poly', fill: true, closed: true, pts: [[x - 5, y + 14], [x + 5, y + 14], [x, y + 6]] },
    l(x, y + 14, x, y + 20)];
}

// DC source (two cells), 90 wide: + terminal at the top right, - at the bottom right.
export function battery(x, y) {
  return {
    prims: [
      { ...l(x + 45, y + 10, x + 90, y + 10), net: 'VDD' }, { ...l(x + 45, y + 10, x + 45, y + 22), net: 'VDD' },
      l(x + 33, y + 22, x + 57, y + 22), l(x + 39, y + 28, x + 51, y + 28),
      l(x + 33, y + 34, x + 57, y + 34), l(x + 39, y + 40, x + 51, y + 40),
      { ...l(x + 45, y + 40, x + 45, y + 56), net: 'GND' }, { ...l(x + 45, y + 56, x + 90, y + 56), net: 'GND' },
      { ...text('+', x + 70, y + 6, 'middle'), net: 'VDD' }, { ...text('-', x + 70, y + 52, 'middle'), net: 'GND' },
      text('DC +V', x + 45, y + 74, 'middle'),
    ],
    plus: { x: x + 90, y: y + 10 }, minus: { x: x + 90, y: y + 56 },
  };
}

const tag = (net, prims) => prims.map((p) => ({ ...p, net }));
export const supply = (x, y, name = 'VDD') => tag('VDD', [l(x, y, x, y - 8), l(x - 7, y - 8, x + 7, y - 8), text(name, x, y - 12, 'middle')]);
export const ground = (x, y) => tag('GND', [l(x, y, x, y + 6), l(x - 8, y + 6, x + 8, y + 6), l(x - 5, y + 9, x + 5, y + 9), l(x - 2, y + 12, x + 2, y + 12)]);

export function shift(prims, dx, dy) {
  return prims.map((p) => {
    const q = { ...p };
    if ('x' in q) q.x += dx;
    if ('y' in q) q.y += dy;
    if ('x1' in q) { q.x1 += dx; q.x2 += dx; q.y1 += dy; q.y2 += dy; }
    if (q.pts) q.pts = q.pts.map(([x, y]) => [x + dx, y + dy]);
    return q;
  });
}
