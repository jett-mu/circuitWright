// Fixed-point logic simulation. `out` maps "compId:pin" -> 0|1 and persists
// between calls so feedback circuits (latches) keep their memory.
const GATES = {
  and: (a) => a.every(Boolean), nand: (a) => !a.every(Boolean),
  or: (a) => a.some(Boolean),   nor: (a) => !a.some(Boolean),
  xor: (a) => a.filter(Boolean).length % 2 === 1,
  xnor: (a) => a.filter(Boolean).length % 2 === 0,
  not: (a) => !a[0], buf: (a) => !!a[0],
};

// "toComp:pin" -> "fromComp:pin"
export function buildSrc(circ) {
  const src = new Map();
  for (const w of circ.wires) if (w.from.c !== undefined && w.to.c !== undefined) src.set(`${w.to.c}:${w.to.p}`, `${w.from.c}:${w.from.p}`);
  return src;
}

export function simulate(circ, out = {}) {
  const src = buildSrc(circ);
  const live = new Set();
  const input = (c, i) => (out[src.get(`${c.id}:${i}`)] ? 1 : 0);

  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    for (const c of circ.components) {
      let vals;
      if (c.type === 'switch') vals = [c.state.on];
      else if (c.type === 'button') vals = [c.state.down];
      else if (c.type === 'clock') vals = [c.state.on];
      else if (c.type === 'const0') vals = [0];
      else if (c.type === 'const1') vals = [1];
      else if (c.type === 'numpad') {
        const n = c.state.bits; // pin 0 is the most significant bit
        vals = Array.from({ length: n }, (_, i) => (c.state.value >> (n - 1 - i)) & 1);
      }
      else if (GATES[c.type]) {
        const n = c.type === 'not' || c.type === 'buf' ? 1 : 2;
        vals = [GATES[c.type](Array.from({ length: n }, (_, i) => input(c, i)))];
      } else vals = [];
      vals.forEach((v, i) => {
        const k = `${c.id}:${i}`, nv = v ? 1 : 0;
        live.add(k);
        if (out[k] !== nv) { out[k] = nv; changed = true; }
      });
    }
    if (!changed) break;
  }
  for (const k of Object.keys(out)) if (!live.has(k)) delete out[k];
  return out;
}
