// Gate-level circuit -> inverting stages (NOT / NAND2 / NOR2) + terminals.
// Pure data, no DOM, so it can be unit-tested in Node.
import { buildSrc } from './sim.js';

const PRIMARY = { switch: 'SW', button: 'BTN', clock: 'CLK' };
const HIGH = 'HIGH'; // terminal label for constant-1 sources

export function buildNetlist(circ) {
  const src = buildSrc(circ);
  const stages = [];
  let tmp = 0;
  const zeros = new Set(circ.components.filter((c) => c.type === 'const0').map((c) => `${c.id}:0`));
  // '0' = tied to ground; a constant-0 source is just that
  const inNet = (c, i) => { const n = src.get(`${c.id}:${i}`) ?? '0'; return zeros.has(n) ? '0' : n; };
  const emit = (kind, ins, out) => {
    const o = out ?? `t${++tmp}`;
    stages.push({ id: stages.length, kind, ins, out: o });
    return o;
  };

  for (const c of circ.components) {
    const key = `${c.id}:0`;
    const a = inNet(c, 0), b = inNet(c, 1);
    switch (c.type) {
      case 'not': emit('not', [a], key); break;
      case 'buf': emit('not', [emit('not', [a])], key); break;
      case 'nand': emit('nand2', [a, b], key); break;
      case 'nor': emit('nor2', [a, b], key); break;
      case 'and': emit('not', [emit('nand2', [a, b])], key); break;
      case 'or': emit('not', [emit('nor2', [a, b])], key); break;
      case 'xor': case 'xnor': {
        const n1 = emit('nand2', [a, b]);
        const x = emit('nand2', [emit('nand2', [a, n1]), emit('nand2', [b, n1])], c.type === 'xor' ? key : undefined);
        if (c.type === 'xnor') emit('not', [x], key);
        break;
      }
      default: break;
    }
  }

  // Terminals. A part that is wired shows only its wired pins; a part with
  // nothing connected still appears (so gate-less circuits export too).
  const pick = (pins) => (pins.some((p) => p.used) ? pins.filter((p) => p.used) : pins);
  const outputs = [];
  let led = 0, disp = 0;
  for (const c of circ.components) {
    if (c.type === 'bulb') {
      led++;
      outputs.push(...pick([{ net: inNet(c, 0), label: `LED${led}`, used: inNet(c, 0) !== '0' }]));
    } else if (c.type === 'display') {
      disp++;
      outputs.push(...pick(Array.from({ length: c.state.bits }, (_, i) => ({
        net: inNet(c, i), label: `D${disp}[${c.state.bits - 1 - i}]`, used: inNet(c, i) !== '0',
      }))));
    }
  }
  const used = new Set([...stages.flatMap((s) => s.ins), ...outputs.map((o) => o.net)]);
  const inputs = [];
  const counts = {};
  let pad = 0;
  for (const c of circ.components) {
    const base = PRIMARY[c.type];
    if (base) {
      counts[base] = (counts[base] ?? 0) + 1;
      inputs.push(...pick([{ net: `${c.id}:0`, label: `${base}${counts[base]}`, used: used.has(`${c.id}:0`) }]));
    } else if (c.type === 'const1') {
      inputs.push(...pick([{ net: `${c.id}:0`, label: HIGH, used: used.has(`${c.id}:0`) }]));
    } else if (c.type === 'numpad') {
      const name = String.fromCharCode(65 + pad++);
      const bits = c.state.bits;
      inputs.push(...pick(Array.from({ length: bits }, (_, p) => ({
        net: `${c.id}:${p}`, label: bits > 1 ? `${name}[${bits - 1 - p}]` : name, used: used.has(`${c.id}:${p}`),
      }))));
    }
  }
  return { stages, inputs, outputs };
}

const FN = { not: (a) => !a[0], nand2: (a) => !(a[0] && a[1]), nor2: (a) => !(a[0] || a[1]) };

// Evaluate the stage netlist (used by tests to prove the expansion is equivalent).
export function evalNetlist(nl, inputValues, prev = {}) {
  const v = { ...prev, ...inputValues, 0: 0 };
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    for (const s of nl.stages) {
      const r = FN[s.kind](s.ins.map((n) => !!v[n])) ? 1 : 0;
      if (v[s.out] !== r) { v[s.out] = r; changed = true; }
    }
    if (!changed) break;
  }
  return v;
}
