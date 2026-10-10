// Component catalogue + circuit data model (no DOM).
export const GROUPS = ['Inputs', 'Gates', 'Outputs'];

const gate = (label, ins = 2) => ({ label, group: 'Gates', w: 90, h: 60, ins, outs: 1 });

export const DEFS = {
  switch:  { label: 'Switch',  group: 'Inputs',  w: 80,  h: 50,  ins: 0, outs: 1 },
  button:  { label: 'Button',  group: 'Inputs',  w: 70,  h: 60,  ins: 0, outs: 1 },
  clock:   { label: 'Clock',   group: 'Inputs',  w: 80,  h: 50,  ins: 0, outs: 1 },
  const0:  { label: 'Constant 0', group: 'Inputs', w: 70, h: 44, ins: 0, outs: 1 },
  const1:  { label: 'Constant 1', group: 'Inputs', w: 70, h: 44, ins: 0, outs: 1 },
  numpad:  { label: 'Number pad', group: 'Inputs', w: 150, h: 150, ins: 0, outs: 4 },
  and:  gate('AND'),  or:  gate('OR'),  xor:  gate('XOR'),
  nand: gate('NAND'), nor: gate('NOR'), xnor: gate('XNOR'),
  not:  gate('NOT', 1), buf: gate('BUFFER', 1),
  tin:     { label: 'Input terminal', group: null, w: 84, h: 24, ins: 0, outs: 1 },
  tout:    { label: 'Output terminal', group: null, w: 84, h: 24, ins: 1, outs: 0 },
  bulb:    { label: 'Lightbulb', group: 'Outputs', w: 60,  h: 60,  ins: 1, outs: 0 },
  display: { label: 'Hex display', group: 'Outputs', w: 100, h: 120, ins: 4, outs: 0 },
};

export const defaultState = (type) => ({
  switch: () => ({ on: false }),
  button: () => ({ down: false }),
  clock: () => ({ on: false, running: true, hz: 1 }),
  numpad: () => ({ value: 0, bits: 4, base: 'dec', min: 0, max: 15 }),
  display: () => ({ bits: 4, base: 'hex' }),
}[type]?.() ?? {});

// Per-instance geometry: number pads and displays are resizable.
export function dims(c) {
  const d = DEFS[c.type];
  if (c.type === 'numpad') {
    const n = c.state.max - c.state.min + 1;
    const h = n <= 16 ? Math.max(90, 30 + Math.ceil(n / 4) * 30) : 110;
    return { ...d, h, outs: c.state.bits };
  }
  if (c.type === 'display') {
    const { bits, base } = c.state;
    const len = base === 'bin' ? bits : base === 'hex' ? Math.ceil(bits / 4) : String(2 ** bits - 1).length;
    // grow the body so the readout (about 20px per digit) never overflows
    return { ...d, w: Math.max(100, 44 + len * 20), h: Math.max(120, 24 * (bits + 1)), ins: bits };
  }
  return d;
}

export function fmt(v, base, bits) {
  if (base === 'bin') return v.toString(2).padStart(bits, '0');
  if (base === 'hex') return v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
  return String(v);
}

// Pin position relative to the component's top-left corner.
export function localPin(def, side, i) {
  const n = side === 'in' ? def.ins : def.outs;
  return { x: side === 'in' ? 0 : def.w, y: (def.h * (i + 1)) / (n + 1) };
}

export function pinPos(comp, side, i) {
  const p = localPin(dims(comp), side, i);
  return { x: comp.x + p.x, y: comp.y + p.y };
}

export class Circuit {
  constructor() { this.clear(); }

  clear() { this.components = []; this.wires = []; this.seq = 1; }
  get(id) { return this.components.find((c) => c.id === id); }

  add(type, x, y) {
    const c = { id: this.seq++, type, x, y, state: defaultState(type) };
    this.components.push(c);
    return c;
  }

  // Wires touching a removed part stay behind as open-ended wires.
  remove(id) {
    const gone = this.get(id);
    this.components = this.components.filter((c) => c.id !== id);
    for (const w of this.wires) {
      if (w.from.c === id) w.from = pinPos(gone, 'out', w.from.p);
      if (w.to.c === id) w.to = pinPos(gone, 'in', w.to.p);
    }
  }

  // Change a part's settings (bits/base/range/...). Wires on pins that no
  // longer exist are left open-ended where the pin used to be.
  configure(c, patch) {
    const held = this.wires.map((w) => ({
      w,
      from: w.from.c === c.id ? pinPos(c, 'out', w.from.p) : null,
      to: w.to.c === c.id ? pinPos(c, 'in', w.to.p) : null,
    }));
    const s = c.state, ob = s.bits, oldTop = 2 ** (s.bits ?? 0) - 1, wasFull = s.max === oldTop;
    Object.assign(s, patch);
    const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v) || 0));
    if ('bits' in s) s.bits = int(s.bits, 1, 8);
    if (c.type === 'numpad') {
      const top = 2 ** s.bits - 1;
      if (patch.bits !== undefined && patch.max === undefined && wasFull) s.max = top;
      s.max = int(s.max, 0, top);
      s.min = int(s.min, 0, s.max);
      s.value = int(s.value, s.min, s.max);
    }
    if (c.type === 'clock') s.hz = Math.min(30, Math.max(0.05, Math.round((+s.hz || 1) * 1000) / 1000));
    // Pin 0 is the most significant bit, so growing/shrinking happens at the TOP:
    // each existing bit keeps its wire, i.e. pins shift down by the change.
    if (ob !== undefined && s.bits !== ob && (c.type === 'numpad' || c.type === 'display')) {
      const delta = s.bits - ob;
      for (const { w, from, to } of held) {
        const end = c.type === 'numpad' ? (from && w.from) : (to && w.to);
        if (!end) continue;
        const np = end.p + delta;
        if (np < 0) { if (c.type === 'numpad') w.from = from; else w.to = to; } // bit removed -> open end
        else end.p = np;
      }
    }
    const d = dims(c);
    for (const { w, from, to } of held) {
      if (from && w.from.p >= d.outs) w.from = from;
      if (to && w.to.p >= d.ins) w.to = to;
    }
  }

  removeWire(id) { this.wires = this.wires.filter((w) => w.id !== id); }

  // Each end is a pin {c,p} or a free point {x,y} (open end). An input pin
  // accepts one wire.
  connect(from, to) {
    if (to.c !== undefined) this.wires = this.wires.filter((w) => !(w.to.c === to.c && w.to.p === to.p));
    this.wires.push({ id: this.seq++, from: { ...from }, to: { ...to } });
  }

  toJSON() {
    return { app: 'gatewright', version: 1, components: this.components, wires: this.wires };
  }

  load(data) {
    if (!data || !Array.isArray(data.components) || !Array.isArray(data.wires)) throw new Error('Not a Gatewright circuit file');
    this.clear();
    for (const c of data.components) {
      if (!DEFS[c.type]) continue;
      this.components.push({ id: +c.id, type: c.type, x: +c.x || 0, y: +c.y || 0, state: { ...defaultState(c.type), ...(c.state || {}) } });
    }
    const end = (e, side) => {
      if (e?.c !== undefined) {
        const c = this.get(e.c);
        return c && e.p < dims(c)[side === 'in' ? 'ins' : 'outs'] ? { c: c.id, p: +e.p } : null;
      }
      return Number.isFinite(e?.x) && Number.isFinite(e?.y) ? { x: e.x, y: e.y } : null;
    };
    for (const w of data.wires) {
      const from = end(w.from, 'out'), to = end(w.to, 'in');
      if (from && to) this.wires.push({ id: +w.id, from, to });
    }
    const ids = [...this.components, ...this.wires].map((o) => o.id);
    this.seq = Math.max(0, ...ids) + 1;
  }
}
