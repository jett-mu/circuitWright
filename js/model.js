// Part catalogue and circuit data model. DOM free, so the solver tests can run in Node.
//
// Geometry: every part is drawn in local pixel coordinates around its origin, pins sit on the
// 10px grid, and a part is placed with `rot` (quarter turns, clockwise) and `flip` (mirror in x,
// applied before the rotation). Nothing is tied to a left-to-right flow.

export const GRID = 10;
export const snap = (v) => Math.round(v / GRID) * GRID;

export function rotPt(x, y, rot = 0, flip = false) {
  if (flip) x = -x;
  switch (rot & 3) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}

// ---- engineering notation -------------------------------------------------
const PREFIX = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];

export function fmt(v, unit = '') {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return (v < 0 ? '−' : '') + '∞' + unit;
  const a = Math.abs(v);
  if (a < 1e-15) return '0' + unit;
  for (const [m, p] of PREFIX) {
    if (a >= m * 0.9995) {
      const x = v / m, ax = Math.abs(x);
      const s = ax >= 100 ? x.toFixed(0) : ax >= 10 ? x.toFixed(1) : x.toFixed(2);
      return String(+s) + p + unit;
    }
  }
  return v.toExponential(1) + unit;
}

const MULT = { k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, U: 1e-6, 'µ': 1e-6, n: 1e-9, N: 1e-9, p: 1e-12, P: 1e-12, f: 1e-15, G: 1e9, T: 1e12 };

// "4.7k", "100n", "1Meg", "2.2µF" -> number. NaN when it cannot be read.
export function parseVal(str) {
  const m = String(str).trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|[kKMmuUµnNpPfGT])?/i);
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  const s = m[2];
  if (s) v *= s.toLowerCase() === 'meg' ? 1e6 : MULT[s] ?? 1;
  return v;
}

// ---- part catalogue --------------------------------------------------------
const num = (k, label, def, unit, o = {}) => ({ k, label, def, unit, type: 'num', ...o });
const sel = (k, label, def, opts) => ({ k, label, def, type: 'sel', opts });
const txt = (k, label, def) => ({ k, label, def, type: 'text' });
const on2 = (k, label, def) => ({ k, label, def, type: 'bool' });

const LED_COLORS = [['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green'], ['blue', 'Blue'], ['white', 'White']];
export const LED_VF = { red: 1.9, yellow: 2.0, green: 2.1, blue: 3.0, white: 3.1 };

// pins: [name, x, y]; box: [x0, y0, x1, y1] local hit/selection box; dir: leave direction for
// single pin parts. ref: designator prefix. body: half length of the body of a two pin part
// (used for the current flow animation on its leads).
export const DEFS = {
  // ---- sources
  vdc: { label: 'DC voltage', group: 'Sources', ref: 'V', pins: [['+', 0, -30], ['−', 0, 30]], box: [-14, -30, 14, 30], body: 14,
    params: [num('v', 'Voltage', 5, 'V')] },
  battery: { label: 'Battery', group: 'Sources', ref: 'B', pins: [['+', 0, -30], ['−', 0, 30]], box: [-14, -30, 14, 30], body: 12,
    params: [num('v', 'Voltage', 9, 'V'), num('r', 'Internal R', 0.5, 'Ω', { min: 0 })] },
  vac: { label: 'AC / signal source', group: 'Sources', ref: 'V', pins: [['+', 0, -30], ['−', 0, 30]], box: [-14, -30, 14, 30], body: 14,
    params: [sel('wave', 'Waveform', 'sine', [['sine', 'Sine'], ['square', 'Square'], ['tri', 'Triangle'], ['saw', 'Sawtooth']]),
      num('amp', 'Amplitude', 5, 'V'), num('freq', 'Frequency', 1000, 'Hz', { min: 1e-3 }), num('offset', 'DC offset', 0, 'V'),
      num('phase', 'Phase', 0, '°'), num('duty', 'Duty', 50, '%', { min: 1, max: 99 })] },
  idc: { label: 'Current source', group: 'Sources', ref: 'I', pins: [['in', 0, -30], ['out', 0, 30]], box: [-14, -30, 14, 30], body: 14,
    params: [num('i', 'Current', 0.01, 'A')] },
  ground: { label: 'Ground', group: 'Sources', ref: '', pins: [['G', 0, 0]], box: [-12, -4, 12, 22], dir: [0, -1], params: [] },
  vcc: { label: 'Supply rail', group: 'Sources', ref: '', pins: [['V', 0, 0]], box: [-14, -26, 14, 4], dir: [0, 1],
    params: [txt('name', 'Net name', 'VCC')] },
  netlabel: { label: 'Net label', group: 'Sources', ref: '', pins: [['N', 0, 0]], box: [-4, -10, 44, 10], dir: [-1, 0],
    params: [txt('name', 'Net name', 'NET')] },

  // ---- passive
  resistor: { label: 'Resistor', group: 'Passive', ref: 'R', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -10, 30, 10], body: 18,
    params: [num('r', 'Resistance', 1000, 'Ω', { min: 1e-6 })] },
  pot: { label: 'Potentiometer', group: 'Passive', ref: 'RV', pins: [['A', -30, 0], ['B', 30, 0], ['W', 0, -20]], box: [-30, -20, 30, 10], body: 18,
    params: [num('r', 'Total R', 10000, 'Ω', { min: 1e-3 }), num('w', 'Wiper', 50, '%', { min: 0, max: 100 })] },
  capacitor: { label: 'Capacitor', group: 'Passive', ref: 'C', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -12, 30, 12], body: 4,
    params: [num('c', 'Capacitance', 1e-6, 'F', { min: 1e-15 })] },
  ecap: { label: 'Electrolytic cap', group: 'Passive', ref: 'C', pins: [['+', -30, 0], ['−', 30, 0]], box: [-30, -14, 30, 12], body: 4,
    params: [num('c', 'Capacitance', 100e-6, 'F', { min: 1e-12 })] },
  inductor: { label: 'Inductor', group: 'Passive', ref: 'L', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -8, 30, 8], body: 16,
    params: [num('l', 'Inductance', 10e-3, 'H', { min: 1e-12 }), num('dcr', 'Series R', 0.1, 'Ω', { min: 0 })] },
  transformer: { label: 'Transformer', group: 'Passive', ref: 'T', pins: [['P1', -30, -20], ['P2', -30, 20], ['S1', 30, -20], ['S2', 30, 20]], box: [-30, -30, 30, 30],
    params: [num('n', 'Turns ratio Np:Ns', 2, ':1', { min: 0.001 }), num('lp', 'Primary L', 0.1, 'H', { min: 1e-9 }),
      num('k', 'Coupling', 0.98, '', { min: 0.5, max: 0.9999 }), num('rp', 'Primary R', 0.5, 'Ω', { min: 0 })] },
  fuse: { label: 'Fuse', group: 'Passive', ref: 'F', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -8, 30, 8], body: 16,
    params: [num('rating', 'Rating', 1, 'A', { min: 1e-3 }), num('r', 'Resistance', 0.05, 'Ω', { min: 1e-4 })], state: { blown: false, heat: 0 } },

  // ---- switches
  switch: { label: 'Switch', group: 'Switches', ref: 'SW', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -14, 30, 10], body: 14, params: [], state: { closed: false } },
  button: { label: 'Push button', group: 'Switches', ref: 'SW', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -22, 30, 10], body: 14, params: [], state: { closed: false } },
  spdt: { label: 'Changeover switch', group: 'Switches', ref: 'SW', pins: [['COM', -30, 0], ['A', 30, -10], ['B', 30, 10]], box: [-30, -16, 30, 16], params: [], state: { pos: 0 } },
  relay: { label: 'Relay', group: 'Switches', ref: 'K', pins: [['C1', -30, -10], ['C2', -30, 10], ['NC', 30, -20], ['COM', 30, 0], ['NO', 30, 20]], box: [-30, -24, 30, 24],
    params: [num('vpull', 'Pull-in voltage', 5, 'V', { min: 0.1 }), num('rcoil', 'Coil R', 100, 'Ω', { min: 1 }), num('lcoil', 'Coil L', 0.05, 'H', { min: 1e-6 })], state: { on: false } },

  // ---- semiconductors
  diode: { label: 'Diode', group: 'Semiconductors', ref: 'D', pins: [['A', -30, 0], ['K', 30, 0]], box: [-30, -10, 30, 10], body: 8,
    params: [num('is', 'Sat. current', 1e-14, 'A', { min: 1e-18 }), num('n', 'Ideality', 1, '', { min: 0.5, max: 4 })] },
  schottky: { label: 'Schottky diode', group: 'Semiconductors', ref: 'D', pins: [['A', -30, 0], ['K', 30, 0]], box: [-30, -10, 30, 10], body: 8,
    params: [num('is', 'Sat. current', 1e-8, 'A', { min: 1e-18 }), num('n', 'Ideality', 1.05, '', { min: 0.5, max: 4 })] },
  zener: { label: 'Zener diode', group: 'Semiconductors', ref: 'DZ', pins: [['A', -30, 0], ['K', 30, 0]], box: [-30, -10, 30, 10], body: 8,
    params: [num('vz', 'Zener voltage', 5.1, 'V', { min: 0.5 })] },
  led: { label: 'LED', group: 'Semiconductors', ref: 'D', pins: [['A', -30, 0], ['K', 30, 0]], box: [-30, -22, 30, 10], body: 8,
    params: [sel('color', 'Colour', 'red', LED_COLORS)] },
  scr: { label: 'Thyristor (SCR)', group: 'Semiconductors', ref: 'Q', pins: [['A', -30, 0], ['K', 30, 0], ['G', 10, 20]], box: [-30, -10, 30, 20],
    params: [num('vgt', 'Gate trigger', 0.8, 'V', { min: 0.1 }), num('ih', 'Holding current', 0.005, 'A', { min: 1e-6 })], state: { on: false } },
  npn: { label: 'NPN transistor', group: 'Semiconductors', ref: 'Q', pins: [['B', -30, 0], ['C', 10, -30], ['E', 10, 30]], box: [-30, -30, 26, 30],
    params: [num('bf', 'Gain β', 100, '', { min: 1 }), num('is', 'Sat. current', 1e-14, 'A', { min: 1e-18 }), num('vaf', 'Early V', 100, 'V', { min: 1 })] },
  pnp: { label: 'PNP transistor', group: 'Semiconductors', ref: 'Q', pins: [['B', -30, 0], ['C', 10, 30], ['E', 10, -30]], box: [-30, -30, 26, 30],
    params: [num('bf', 'Gain β', 100, '', { min: 1 }), num('is', 'Sat. current', 1e-14, 'A', { min: 1e-18 }), num('vaf', 'Early V', 100, 'V', { min: 1 })] },
  nmos: { label: 'N-MOSFET', group: 'Semiconductors', ref: 'M', pins: [['G', -30, 0], ['D', 10, -30], ['S', 10, 30]], box: [-30, -30, 26, 30],
    params: [num('vth', 'Threshold', 2, 'V'), num('kp', 'Transconductance', 0.2, 'A/V²', { min: 1e-6 }), num('lambda', 'λ', 0.01, '1/V', { min: 0 }),
      on2('body', 'Body diode', true)] },
  pmos: { label: 'P-MOSFET', group: 'Semiconductors', ref: 'M', pins: [['G', -30, 0], ['D', 10, 30], ['S', 10, -30]], box: [-30, -30, 26, 30],
    params: [num('vth', 'Threshold', 2, 'V'), num('kp', 'Transconductance', 0.2, 'A/V²', { min: 1e-6 }), num('lambda', 'λ', 0.01, '1/V', { min: 0 }),
      on2('body', 'Body diode', true)] },
  njfet: { label: 'N-JFET', group: 'Semiconductors', ref: 'J', pins: [['G', -30, 0], ['D', 10, -30], ['S', 10, 30]], box: [-30, -30, 26, 30],
    params: [num('vto', 'Pinch-off', -2, 'V'), num('beta', 'β', 1e-3, 'A/V²', { min: 1e-9 }), num('lambda', 'λ', 0.01, '1/V', { min: 0 })] },
  pjfet: { label: 'P-JFET', group: 'Semiconductors', ref: 'J', pins: [['G', -30, 0], ['D', 10, 30], ['S', 10, -30]], box: [-30, -30, 26, 30],
    params: [num('vto', 'Pinch-off', 2, 'V'), num('beta', 'β', 1e-3, 'A/V²', { min: 1e-9 }), num('lambda', 'λ', 0.01, '1/V', { min: 0 })] },

  // ---- ICs
  opamp: { label: 'Op-amp', group: 'ICs', ref: 'U', pins: [['−', -30, -10], ['+', -30, 10], ['OUT', 30, 0]], box: [-30, -22, 30, 22],
    params: [num('vsat', 'Output swing ±', 12, 'V', { min: 0.1 }), num('gain', 'Open loop gain', 1e5, '', { min: 10 })] },
  timer555: { label: '555 timer', group: 'ICs', ref: 'U', pins: [['GND', 0, 40], ['TRIG', -50, 20], ['OUT', 50, -20], ['RESET', 50, 20], ['CTRL', 50, 0], ['THR', -50, 0], ['DIS', -50, -20], ['VCC', 0, -40]],
    box: [-50, -40, 50, 40], params: [], state: { q: 0 } },

  // ---- loads and meters
  lamp: { label: 'Lamp', group: 'Loads & meters', ref: 'LA', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -14, 30, 14], body: 12,
    params: [num('v', 'Rated V', 12, 'V', { min: 0.1 }), num('w', 'Rated W', 5, 'W', { min: 0.01 })] },
  motor: { label: 'Motor', group: 'Loads & meters', ref: 'M', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -14, 30, 14], body: 12,
    params: [num('r', 'Winding R', 5, 'Ω', { min: 0.01 }), num('l', 'Inductance', 2e-3, 'H', { min: 1e-9 })] },
  speaker: { label: 'Speaker', group: 'Loads & meters', ref: 'LS', pins: [['A', -30, 0], ['B', 30, 0]], box: [-30, -14, 30, 14], body: 10,
    params: [num('r', 'Impedance', 8, 'Ω', { min: 0.1 })] },
  voltmeter: { label: 'Voltmeter', group: 'Loads & meters', ref: 'VM', pins: [['+', -30, 0], ['−', 30, 0]], box: [-30, -14, 30, 14], body: 12, params: [] },
  ammeter: { label: 'Ammeter', group: 'Loads & meters', ref: 'AM', pins: [['+', -30, 0], ['−', 30, 0]], box: [-30, -14, 30, 14], body: 12, params: [] },
  probe: { label: 'Scope probe', group: 'Loads & meters', ref: 'P', pins: [['P', 0, 0]], box: [-8, -26, 30, 8], dir: [0, 1], params: [] },
};

for (const [type, d] of Object.entries(DEFS)) d.type = type;

export const GROUPS = ['Sources', 'Passive', 'Switches', 'Semiconductors', 'ICs', 'Loads & meters'];

export const defaultParams = (type) => Object.fromEntries(DEFS[type].params.map((p) => [p.k, p.def]));

// Short value text shown under each part on the diagram.
export function valueText(c) {
  const p = c.params;
  switch (c.type) {
    case 'vdc': case 'battery': return fmt(p.v, 'V');
    case 'vac': return `${fmt(p.amp, 'V')} ${fmt(p.freq, 'Hz')}`;
    case 'idc': return fmt(p.i, 'A');
    case 'resistor': return fmt(p.r, 'Ω');
    case 'pot': return `${fmt(p.r, 'Ω')} @${Math.round(p.w)}%`;
    case 'capacitor': case 'ecap': return fmt(p.c, 'F');
    case 'inductor': return fmt(p.l, 'H');
    case 'transformer': return `${fmt(p.n)}:1`;
    case 'fuse': return fmt(p.rating, 'A');
    case 'zener': return fmt(p.vz, 'V');
    case 'led': return p.color;
    case 'npn': case 'pnp': return `β${fmt(p.bf)}`;
    case 'nmos': case 'pmos': return `Vth ${fmt(p.vth, 'V')}`;
    case 'njfet': case 'pjfet': return `Vp ${fmt(p.vto, 'V')}`;
    case 'opamp': return `±${fmt(p.vsat, 'V')}`;
    case 'relay': return fmt(p.vpull, 'V');
    case 'lamp': return `${fmt(p.v, 'V')} ${fmt(p.w, 'W')}`;
    case 'motor': return fmt(p.r, 'Ω');
    case 'speaker': return fmt(p.r, 'Ω');
    case 'vcc': case 'netlabel': return '';
    default: return '';
  }
}

// ---- circuit ----------------------------------------------------------------
export class Circuit {
  constructor() { this.components = []; this.wires = []; this.nextId = 1; this.title = 'Untitled circuit'; this.meta = {}; }

  comp(id) { return this.components.find((c) => c.id === id); }
  wire(id) { return this.wires.find((w) => w.id === id); }

  designator(type) {
    const ref = DEFS[type].ref;
    if (!ref) return '';
    let hi = 0;
    for (const c of this.components) {
      const m = c.label.match(/^([A-Z]+)(\d+)$/);
      if (m && m[1] === ref) hi = Math.max(hi, +m[2]);
    }
    return ref + (hi + 1);
  }

  add(type, x, y, o = {}) {
    const def = DEFS[type];
    if (!def) throw new Error('unknown part ' + type);
    const c = {
      id: this.nextId++, type, x: snap(x), y: snap(y), rot: (o.rot ?? 0) & 3, flip: !!o.flip,
      label: o.label ?? this.designator(type),
      params: { ...defaultParams(type), ...(o.params || {}) },
      state: { ...(def.state || {}), ...(o.state || {}) },
    };
    this.components.push(c);
    return c;
  }

  addWire(a, b, o = {}) {
    const w = { id: this.nextId++, a, b, via: o.via || [], style: o.style || 'auto' };
    this.wires.push(w);
    return w;
  }

  remove(compIds = [], wireIds = []) {
    const cs = new Set(compIds), ws = new Set(wireIds);
    this.components = this.components.filter((c) => !cs.has(c.id));
    this.wires = this.wires.filter((w) => !ws.has(w.id) && !(w.a.c != null && cs.has(w.a.c)) && !(w.b.c != null && cs.has(w.b.c)));
  }

  pinPos(c, i) {
    const [, lx, ly] = DEFS[c.type].pins[i];
    const [dx, dy] = rotPt(lx, ly, c.rot, c.flip);
    return { x: c.x + dx, y: c.y + dy };
  }

  // Unit vector (world) along which a wire should leave a pin.
  pinDir(c, i) {
    const def = DEFS[c.type];
    let [, lx, ly] = def.pins[i];
    let ux, uy;
    if (def.dir && def.pins.length === 1) [ux, uy] = def.dir;
    else if (Math.abs(lx) >= Math.abs(ly) && lx !== 0) [ux, uy] = [Math.sign(lx), 0];
    else if (ly !== 0) [ux, uy] = [0, Math.sign(ly)];
    else [ux, uy] = [1, 0];
    const [dx, dy] = rotPt(ux, uy, c.rot, c.flip);
    return { x: dx, y: dy };
  }

  // A free wire end that sits exactly on a pin is that pin's connection; make it explicit so the
  // wire stays attached when either part moves.
  pinAt(x, y) {
    for (const c of this.components) {
      const pins = DEFS[c.type].pins;
      for (let i = 0; i < pins.length; i++) {
        const p = this.pinPos(c, i);
        if (p.x === x && p.y === y) return { c: c.id, p: i };
      }
    }
    return null;
  }

  snapEnds() {
    for (const w of this.wires) {
      for (const k of ['a', 'b']) {
        const e = w[k];
        if (e.c == null) { const h = this.pinAt(e.x, e.y); if (h) w[k] = h; }
      }
    }
  }

  endPos(e) {
    if (e.c != null) {
      const c = this.comp(e.c);
      return c ? this.pinPos(c, e.p) : { x: e.x ?? 0, y: e.y ?? 0 };
    }
    return { x: e.x, y: e.y };
  }

  endDir(e) { return e.c != null && this.comp(e.c) ? this.pinDir(this.comp(e.c), e.p) : null; }

  // Polyline a wire is drawn along. Corners follow the wire's style so that the first leg
  // leaves a pin the way that pin faces.
  wirePath(w) {
    const A = this.endPos(w.a), B = this.endPos(w.b);
    const pts = [A, ...(w.via || []), B];
    let style = w.style && w.style !== 'auto' ? w.style : null;
    const da = this.endDir(w.a), db = this.endDir(w.b);
    const horiz = (d) => d && Math.abs(d.x) > Math.abs(d.y);
    if (!style && pts.length === 2 && (da || db) && (A.x !== B.x || A.y !== B.y)) {
      // Leave a pin the way it faces. When the target is behind the pin, step out first so the
      // wire does not run back through its own part.
      const behind = (P, Q, d) => d && (Q.x - P.x) * d.x + (Q.y - P.y) * d.y < -20;
      const step = (P, d) => ({ x: P.x + d.x * 20, y: P.y + d.y * 20 });
      const sa = behind(A, B, da), sb = behind(B, A, db);
      const a1 = sa ? step(A, da) : A, b1 = sb ? step(B, db) : B;
      if (sa || sb) {
        const out = [A];
        if (sa) out.push(a1);
        if (a1.x !== b1.x && a1.y !== b1.y) {
          const hFirst = sa ? !horiz(da) : horiz(db);
          out.push(hFirst ? { x: b1.x, y: a1.y } : { x: a1.x, y: b1.y });
        }
        if (sb) out.push(b1);
        out.push(B);
        return dedupe(out);
      }
      if (da && db && A.x !== B.x && A.y !== B.y) {
        // Both ends are pins: use a three leg route when both face the same axis.
        if (horiz(da) && horiz(db)) {
          const mx = snap((A.x + B.x) / 2);
          return dedupe([A, { x: mx, y: A.y }, { x: mx, y: B.y }, B]);
        }
        if (!horiz(da) && !horiz(db)) {
          const my = snap((A.y + B.y) / 2);
          return dedupe([A, { x: A.x, y: my }, { x: B.x, y: my }, B]);
        }
      }
    }
    if (!style) style = da ? (horiz(da) ? 'hv' : 'vh') : db ? (horiz(db) ? 'vh' : 'hv') : 'hv';
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = out[out.length - 1], q = pts[i];
      if (style !== 'diag' && p.x !== q.x && p.y !== q.y) out.push(style === 'hv' ? { x: q.x, y: p.y } : { x: p.x, y: q.y });
      out.push(q);
    }
    return dedupe(out);
  }

  toJSON() {
    return {
      app: 'circuitwright', version: 1, title: this.title, meta: this.meta,
      components: this.components.map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot, flip: c.flip, label: c.label, params: c.params, state: c.state })),
      wires: this.wires.map((w) => ({ id: w.id, a: w.a, b: w.b, via: w.via, style: w.style })),
    };
  }

  load(o) {
    if (!o || o.app !== 'circuitwright' || !Array.isArray(o.components)) throw new Error('Not a Circuitwright file');
    this.components = []; this.wires = []; this.nextId = 1;
    this.title = typeof o.title === 'string' ? o.title : 'Untitled circuit';
    this.meta = o.meta && typeof o.meta === 'object' ? { ...o.meta } : {};
    for (const c of o.components) {
      if (!DEFS[c.type]) continue;
      this.components.push({
        id: c.id, type: c.type, x: snap(+c.x || 0), y: snap(+c.y || 0), rot: (c.rot | 0) & 3, flip: !!c.flip,
        label: String(c.label ?? ''), params: { ...defaultParams(c.type), ...(c.params || {}) }, state: { ...(DEFS[c.type].state || {}), ...(c.state || {}) },
      });
    }
    const have = new Set(this.components.map((c) => c.id));
    for (const w of o.wires || []) {
      const ok = (e) => e && (e.c != null ? have.has(e.c) && DEFS[this.comp(e.c).type].pins[e.p] : Number.isFinite(e.x) && Number.isFinite(e.y));
      if (ok(w.a) && ok(w.b)) this.wires.push({ id: w.id, a: w.a, b: w.b, via: (w.via || []).map((p) => ({ x: p.x, y: p.y })), style: w.style || 'auto' });
    }
    this.nextId = 1 + Math.max(0, ...this.components.map((c) => c.id), ...this.wires.map((w) => w.id));
    this.snapEnds();
  }

  clone() { const c = new Circuit(); c.load(JSON.parse(JSON.stringify(this.toJSON()))); return c; }
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || out[out.length - 1].x !== p.x || out[out.length - 1].y !== p.y) out.push(p);
  return out.length === 1 ? [out[0], out[0]] : out;
}

// World bounding box of a part (rotated local box).
export function compBox(c) {
  const [x0, y0, x1, y1] = DEFS[c.type].box;
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => rotPt(x, y, c.rot, c.flip));
  const xs = pts.map((p) => p[0] + c.x), ys = pts.map((p) => p[1] + c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function circuitBounds(circ) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const c of circ.components) { const b = compBox(c); add(b.x0, b.y0); add(b.x1, b.y1); }
  for (const w of circ.wires) for (const p of circ.wirePath(w)) add(p.x, p.y);
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
