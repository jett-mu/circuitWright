// Derive the circuit actually drawn by the gate-level export: optionally replace
// input widgets (switch/button/clock/number pad) and output widgets
// (bulb/display) with plain terminal nodes, one per bit. No DOM.
import { Circuit, dims } from './model.js';
import { simulate } from './sim.js';

const INPUTS = new Set(['switch', 'button', 'clock', 'numpad']);
const OUTPUTS = new Set(['bulb', 'display']);
const TERM_W = 84, TERM_PITCH = 30;

export function exportView(circ, out, { subInputs = false, subOutputs = false, deactivateInputs = false } = {}) {
  const v = new Circuit();
  v.load(JSON.parse(JSON.stringify(circ.toJSON())));
  if (deactivateInputs) { // every input low / at its lowest value, signals recomputed from scratch
    for (const c of v.components) {
      if (c.type === 'switch') c.state.on = false;
      else if (c.type === 'button') c.state.down = false;
      else if (c.type === 'clock') c.state.on = false;
      else if (c.type === 'numpad') c.state.value = c.state.min;
    }
    out = simulate(v, {});
  }
  const out2 = { ...out };
  if (!subInputs && !subOutputs) return { circ: v, out: out2 };

  let next = v.seq;
  const outMap = new Map(); // old output pin  `${id}:${p}` -> terminal id
  const inMap = new Map();  // old input pin   `${id}:${p}` -> terminal id
  const names = {};
  const name = (base) => { names[base] = (names[base] ?? 0) + 1; return `${base}${names[base]}`; };
  let pad = 0;
  const replaced = new Set();

  for (const c of circ.components) {
    const d = dims(c);
    const isIn = subInputs && INPUTS.has(c.type), isOut = subOutputs && OUTPUTS.has(c.type);
    if (!isIn && !isOut) continue;
    const n = isIn ? d.outs : d.ins;
    let labels;
    if (c.type === 'numpad') {
      const L = String.fromCharCode(65 + pad++);
      labels = Array.from({ length: n }, (_, p) => (n > 1 ? `${L}[${n - 1 - p}]` : L));
    } else if (c.type === 'display') {
      const L = name('D');
      labels = Array.from({ length: n }, (_, p) => (n > 1 ? `${L}[${n - 1 - p}]` : L));
    } else labels = [name({ switch: 'SW', button: 'BTN', clock: 'CLK', bulb: 'LED' }[c.type])];

    const x = isIn ? c.x + d.w - TERM_W : c.x;
    const y0 = c.y + (d.h - (n * TERM_PITCH - (TERM_PITCH - 24))) / 2;
    replaced.add(c.id);
    for (let p = 0; p < n; p++) {
      const id = next++;
      v.components.push({ id, type: isIn ? 'tin' : 'tout', x, y: Math.round(y0 + p * TERM_PITCH), state: { label: labels[p] } });
      (isIn ? outMap : inMap).set(`${c.id}:${p}`, id);
      if (isIn) out2[`${id}:0`] = out[`${c.id}:${p}`] ?? 0;
    }
  }
  v.components = v.components.filter((c) => !replaced.has(c.id));
  for (const w of v.wires) {
    if (w.from.c !== undefined && outMap.has(`${w.from.c}:${w.from.p}`)) w.from = { c: outMap.get(`${w.from.c}:${w.from.p}`), p: 0 };
    if (w.to.c !== undefined && inMap.has(`${w.to.c}:${w.to.p}`)) w.to = { c: inMap.get(`${w.to.c}:${w.to.p}`), p: 0 };
  }
  v.seq = next;
  return { circ: v, out: out2 };
}
