// Schematic symbols, drawn in local pixel coordinates around the part origin.
// A symbol function appends its shapes to group `g` and may return update(live) for the
// parts that react to the simulation (switch blade, LED glow, fuse, lamp...).
const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  for (const k of [].concat(kids)) if (k != null) e.append(k);
  return e;
}

const P = (g, d, cls = 'sym') => g.appendChild(el('path', { d, class: cls }));
const Cir = (g, cx, cy, r, cls = 'sym symb') => g.appendChild(el('circle', { cx, cy, r, class: cls }));
const Dot = (g, cx, cy) => g.appendChild(el('circle', { cx, cy, r: 2.4, class: 'symf' }));
const Rect = (g, x, y, w, h, cls = 'sym symb') => g.appendChild(el('rect', { x, y, width: w, height: h, class: cls }));
const Tri = (g, pts) => g.appendChild(el('path', { d: 'M' + pts.map((p) => p.join(',')).join('L') + 'Z', class: 'symf' }));

// Text that stays upright and unmirrored whatever the part's orientation.
function T(g, c, s, x, y, cls = 'symt') {
  const t = el('text', { class: cls, x: 0, y: 0 });
  t.textContent = s;
  const wrap = el('g', { transform: `translate(${x} ${y}) scale(${c.flip ? -1 : 1} 1) rotate(${-90 * c.rot})` }, t);
  g.appendChild(wrap);
  return t;
}

const bar2 = (g) => P(g, 'M-30,0 H-8 M8,0 H30');

const diodeBody = (g, extra = '') => {
  bar2(g);
  g.appendChild(el('path', { d: 'M-8,-8 L-8,8 L8,0 Z', class: 'sym symb' }));
  P(g, 'M8,-8 V8' + extra);
};

function fet(g, c, p) {
  const tieTop = p; // p-channel: the source is the top lead
  P(g, 'M-30,0 H-12');
  P(g, 'M-12,-12 V12');
  P(g, 'M-6,-14 V-8 M-6,-4 V4 M-6,8 V14');
  P(g, 'M-6,-11 H10 V-30');
  P(g, 'M-6,11 H10 V30');
  P(g, tieTop ? 'M-6,0 H10 V-11' : 'M-6,0 H10 V11');
  if (p) Tri(g, [[-1, 0], [-6, -3], [-6, 3]]);
  else Tri(g, [[-6, 0], [-1, -3], [-1, 3]]);
  Dot(g, 10, tieTop ? -11 : 11);
}

function jfet(g, c, p) {
  P(g, 'M-30,0 H-4');
  P(g, 'M-4,-14 V14');
  P(g, 'M-4,-11 H10 V-30');
  P(g, 'M-4,11 H10 V30');
  if (p) Tri(g, [[-13, 0], [-6, -3], [-6, 3]]);
  else Tri(g, [[-6, 0], [-13, -3], [-13, 3]]);
}

function bjt(g, c, isNpn) {
  Cir(g, 0, 0, 22, 'sym symb thin');
  P(g, 'M-30,0 H-6');
  P(g, 'M-6,-14 V14', 'sym thick');
  P(g, 'M-6,-6 L10,-18 V-30');
  P(g, 'M-6,6 L10,18 V30');
  // NPN: arrow leaves the base on the bottom (emitter) lead.
  // PNP: the emitter is the top lead and the arrow points into the base.
  if (isNpn) Tri(g, [[6.8, 15.6], [0.2, 14.4], [3.8, 9.6]]);
  else Tri(g, [[-2, -9], [4.6, -10.2], [1.0, -15.0]]);
}

export const SYMBOLS = {
  vdc(g, c) {
    P(g, 'M0,-30 V-12 M0,12 V30');
    Cir(g, 0, 0, 12);
    P(g, 'M-3.5,-6 H3.5 M0,-9.5 V-2.5 M-3.5,6 H3.5', 'sym thin');
  },
  battery(g, c) {
    P(g, 'M0,-30 V-9 M0,9 V30');
    P(g, 'M-13,-9 H13 M-7,-3 H7 M-13,3 H13 M-7,9 H7', 'sym thick');
    T(g, c, '+', -19, -9, 'symt');
  },
  vac(g, c) {
    P(g, 'M0,-30 V-12 M0,12 V30');
    Cir(g, 0, 0, 12);
    P(g, 'M-7,0 C-4,-9 -1,-9 0,0 C1,9 4,9 7,0', 'sym thin');
    T(g, c, '+', 17, -17, 'symt');
  },
  idc(g) {
    P(g, 'M0,-30 V-12 M0,12 V30');
    Cir(g, 0, 0, 12);
    P(g, 'M0,-7 V6');
    Tri(g, [[0, 8], [-3.5, 2], [3.5, 2]]);
  },
  ground(g) { P(g, 'M0,0 V10 M-11,10 H11 M-7,15 H7 M-3,20 H3'); },
  vcc(g, c) {
    P(g, 'M0,0 V-12 M-8,-12 H8');
    T(g, c, String(c.params.name || 'VCC').slice(0, 8), 0, -17, 'symt');
  },
  netlabel(g, c) {
    P(g, 'M0,0 H5 L11,-8 H42 V8 H11 L5,0', 'sym symb thin');
    T(g, c, String(c.params.name || '').slice(0, 7), 27, 3.5, 'symt');
  },
  resistor(g) { P(g, 'M-30,0 H-18 L-15,-6 L-9,6 L-3,-6 L3,6 L9,-6 L15,6 L18,0 H30'); },
  pot(g) {
    P(g, 'M-30,0 H-18 L-15,-6 L-9,6 L-3,-6 L3,6 L9,-6 L15,6 L18,0 H30');
    P(g, 'M0,-20 V-9');
    Tri(g, [[0, -7], [-3.5, -13], [3.5, -13]]);
  },
  capacitor(g) { P(g, 'M-30,0 H-4 M4,0 H30'); P(g, 'M-4,-10 V10 M4,-10 V10', 'sym thick'); },
  ecap(g, c) {
    P(g, 'M-30,0 H-3.5 M3.5,0 H30');
    P(g, 'M-3.5,-10 V10', 'sym thick');
    P(g, 'M7.5,-10 Q-0.5,0 7.5,10', 'sym thick');
    P(g, 'M-14,-8 H-8 M-11,-11 V-5', 'sym thin');
  },
  inductor(g) { P(g, 'M-30,0 H-16 a4,4 0 0 1 8,0 a4,4 0 0 1 8,0 a4,4 0 0 1 8,0 a4,4 0 0 1 8,0 H30'); },
  transformer(g, c) {
    P(g, 'M-30,-20 H-8 a5,5 0 0 1 0,10 a5,5 0 0 1 0,10 a5,5 0 0 1 0,10 a5,5 0 0 1 0,10 H-30');
    P(g, 'M30,-20 H8 a5,5 0 0 0 0,10 a5,5 0 0 0 0,10 a5,5 0 0 0 0,10 a5,5 0 0 0 0,10 H30');
    P(g, 'M-2,-22 V22 M2,-22 V22', 'sym thin');
    Dot(g, -17, -26); Dot(g, 17, -26);
  },
  fuse(g) {
    P(g, 'M-30,0 H-16 M16,0 H30');
    Rect(g, -16, -5, 32, 10);
    const link = P(g, 'M-16,0 H16', 'sym thin');
    return (live) => { link.setAttribute('d', live?.blown ? 'M-16,0 H-9 M9,0 H16' : 'M-16,0 H16'); };
  },
  switch(g, c) {
    P(g, 'M-30,0 H-12 M12,0 H30');
    Dot(g, -12, 0); Dot(g, 12, 0);
    const blade = P(g, 'M-12,0 L10,-12');
    return () => blade.setAttribute('d', c.state.closed ? 'M-12,0 H12' : 'M-12,0 L10,-12');
  },
  button(g, c) {
    P(g, 'M-30,0 H-10 M10,0 H30');
    Dot(g, -10, 0); Dot(g, 10, 0);
    const k = el('g'); g.appendChild(k);
    P(k, 'M-14,-7 H14 M0,-7 V-17 M-6,-17 H6');
    return () => k.setAttribute('transform', `translate(0 ${c.state.closed ? 6 : 0})`);
  },
  spdt(g, c) {
    P(g, 'M-30,0 H-12 M12,-10 H30 M12,10 H30');
    Dot(g, -12, 0); Dot(g, 12, -10); Dot(g, 12, 10);
    const blade = P(g, 'M-12,0 L10,-9');
    return () => blade.setAttribute('d', c.state.pos ? 'M-12,0 L10,9' : 'M-12,0 L10,-9');
  },
  relay(g, c) {
    P(g, 'M-30,-10 H-20 M-30,10 H-20');
    Rect(g, -20, -14, 14, 28);
    P(g, 'M-17,-6 H-9 M-17,0 H-9 M-17,6 H-9', 'sym thin');
    P(g, 'M-6,0 H12', 'sym dash');
    P(g, 'M14,0 H30 M24,-20 H30 M24,20 H30');
    Dot(g, 14, 0); Dot(g, 24, -20); Dot(g, 24, 20);
    const blade = P(g, 'M14,0 L22,-17');
    return () => blade.setAttribute('d', c.state.on ? 'M14,0 L22,17' : 'M14,0 L22,-17');
  },
  diode(g) { diodeBody(g); },
  schottky(g) { bar2(g); g.appendChild(el('path', { d: 'M-8,-8 L-8,8 L8,0 Z', class: 'sym symb' })); P(g, 'M12,-6 V-8 H8 V8 H4 V6'); },
  zener(g) { bar2(g); g.appendChild(el('path', { d: 'M-8,-8 L-8,8 L8,0 Z', class: 'sym symb' })); P(g, 'M12,-8 H8 V8 H4'); },
  led(g, c) {
    const glow = Cir(g, 0, 0, 16, 'glow');
    diodeBody(g);
    P(g, 'M0,-11 L8,-19 M3.5,-19 H8 V-14.5');
    P(g, 'M6,-8 L14,-16 M9.5,-16 H14 V-11.5');
    return (live) => {
      const col = { red: '#d64b3a', yellow: '#e2b63a', green: '#4aa860', blue: '#3b6fd6', white: '#f4f1e4' }[c.params.color] || '#d64b3a';
      glow.style.fill = col;
      glow.style.opacity = live ? Math.min(0.95, (live.glow || 0) * 0.8).toFixed(2) : 0;
    };
  },
  scr(g) {
    diodeBody(g);
    P(g, 'M10,20 V14 L8,8');
  },
  npn(g, c) { bjt(g, c, true); },
  pnp(g, c) { bjt(g, c, false); },
  nmos(g, c) { fet(g, c, false); },
  pmos(g, c) { fet(g, c, true); },
  njfet(g, c) { jfet(g, c, false); },
  pjfet(g, c) { jfet(g, c, true); },
  opamp(g, c) {
    P(g, 'M-30,-10 H-20 M-30,10 H-20 M26,0 H30');
    g.appendChild(el('path', { d: 'M-20,-22 V22 L26,0 Z', class: 'sym symb' }));
    P(g, 'M-17,-10 H-9 M-17,10 H-9 M-13,6 V14', 'sym thin');
  },
  timer555(g, c) {
    Rect(g, -40, -30, 80, 60);
    P(g, 'M-50,-20 H-40 M-50,0 H-40 M-50,20 H-40 M50,-20 H40 M50,0 H40 M50,20 H40 M0,-40 V-30 M0,30 V40');
    T(g, c, '555', 0, 5, 'symt big');
    const small = (s, x, y, a) => { const t = T(g, c, s, x, y, 'symt tiny'); t.style.textAnchor = a; };
    small('DIS', -36, -17, 'start'); small('THR', -36, 3, 'start'); small('TRIG', -36, 23, 'start');
    small('OUT', 36, -17, 'end'); small('CTRL', 36, 3, 'end'); small('RST', 36, 23, 'end');
    small('VCC', 0, -24, 'middle'); small('GND', 0, 26, 'middle');
  },
  lamp(g) {
    const glow = Cir(g, 0, 0, 20, 'glow');
    P(g, 'M-30,0 H-12 M12,0 H30');
    Cir(g, 0, 0, 12);
    P(g, 'M-8.5,-8.5 L8.5,8.5 M-8.5,8.5 L8.5,-8.5', 'sym thin');
    return (live) => { glow.style.fill = '#f3c64a'; glow.style.opacity = live ? Math.min(0.9, (live.glow || 0)).toFixed(2) : 0; };
  },
  motor(g, c) {
    P(g, 'M-30,0 H-12 M12,0 H30');
    Cir(g, 0, 0, 12);
    T(g, c, 'M', 0, 4, 'symt');
    const rotor = el('g'); g.appendChild(rotor);
    P(rotor, 'M0,-9 V-5 M0,9 V5', 'sym thin');
    let ang = 0;
    return (live) => { ang = (ang + Math.min(25, Math.abs(live?.i || 0) * 120)) % 360; rotor.setAttribute('transform', `rotate(${ang})`); };
  },
  speaker(g) {
    P(g, 'M-30,0 H-6 M30,0 H14');
    Rect(g, -6, -8, 8, 16);
    g.appendChild(el('path', { d: 'M2,-8 L14,-16 V16 L2,8 Z', class: 'sym symb' }));
  },
  voltmeter(g, c) { P(g, 'M-30,0 H-12 M12,0 H30'); Cir(g, 0, 0, 12); T(g, c, 'V', 0, 4.5, 'symt'); },
  ammeter(g, c) { P(g, 'M-30,0 H-12 M12,0 H30'); Cir(g, 0, 0, 12); T(g, c, 'A', 0, 4.5, 'symt'); },
  probe(g) {
    P(g, 'M0,0 V-12');
    const dot = Cir(g, 0, -17, 6, 'sym probedot');
    return (live) => { if (live?.color) dot.style.fill = live.color; };
  },
};

// Small standalone preview for the palette.
export function previewSVG(def) {
  const [x0, y0, x1, y1] = def.box;
  const pad = 6;
  const svg = el('svg', { class: 'pv', viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}` });
  const g = el('g');
  svg.appendChild(g);
  SYMBOLS[def.type](g, { rot: 0, flip: false, params: Object.fromEntries(def.params.map((p) => [p.k, p.def])), state: { ...(def.state || {}) } });
  return svg;
}
