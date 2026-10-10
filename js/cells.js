// Transistor-level cells for NOT / NAND2 / NOR2 in two technologies.
// Cell-local coordinates; inputs on the left edge (x=0), output on the right.
import { diode, dot, hop, line, mos, npn, relay, resistor, supply, ground, shift, text } from './symbols.js';

export const TECHS = {
  cmos: { label: 'CMOS MOSFET', vdd: 'VDD' },
  bjt: { label: 'BJT NPN (RTL)', vdd: 'VCC' },
  // rails: supply and ground are real wires from a DC source, not local symbols.
  relay: { label: 'Relay (electromechanical)', vdd: '+V', rails: true },
};

// Relay connectivity per gate: coil input, then the contact nets on pins 3 / 4 / 5.
// A coil is energised when its input net is high; then 3-4 are joined, otherwise 4-5.
export const RELAY_NETS = {
  not:   [{ coil: 'a', n3: 'GND', n4: 'out', n5: 'VDD' }],
  nand2: [{ coil: 'a', n3: 'GND', n4: 'x', n5: 'VDD' }, { coil: 'b', n3: 'x', n4: 'out', n5: 'VDD' }],
  nor2:  [{ coil: 'a', n3: 'GND', n4: 'out', n5: 'x' }, { coil: 'b', n3: 'GND', n4: 'x', n5: 'VDD' }],
};
const TOP = 24; // headroom for supply labels / the top input run

function cmos(kind, n) {
  const M = () => `M${++n.M}`;
  const P = [];
  const add = (m) => { P.push(...m.prims); return m; };
  if (kind === 'not') {
    const p = add(mos(40, 40, { p: true, label: M() })), q = add(mos(40, 100, { label: M() }));
    P.push(line(0, 70, 10, 70), line(10, 40, 10, 100), dot(10, 70),
      line(48, 60, 48, 80), line(48, 70, 100, 70), dot(48, 70),
      ...supply(p.top.x, p.top.y), ...ground(q.bot.x, q.bot.y));
    return { w: 100, h: 140, ins: [{ x: 0, y: 70 }], out: { x: 100, y: 70 }, prims: P, mos: 2 };
  }
  if (kind === 'nand2') {
    const pa = add(mos(40, 40, { p: true, label: M() })), pb = add(mos(112, 40, { p: true, mir: true, label: M() }));
    const na = add(mos(40, 100, { label: M() })), nb = add(mos(112, 140, { mir: true, label: M() }));
    P.push(
      line(0, 70, 10, 70), line(10, 40, 10, 100), dot(10, 70),                    // A
      line(0, -12, 142, -12), line(142, -12, 142, 40), line(142, 40, 142, 140), dot(142, 40), // B
      line(48, 20, 104, 20), dot(76, 20), ...supply(76, 20),                        // pull-up
      line(48, 60, 104, 60), line(48, 60, 48, 80), dot(48, 60),                     // output node
      line(104, 60, 137, 60), hop(142, 60), line(147, 60, 170, 60),
      line(48, 120, 104, 120), ...ground(nb.bot.x, nb.bot.y));
    return { w: 170, h: 192, ins: [{ x: 0, y: 70 }, { x: 0, y: -12 }], out: { x: 170, y: 60 }, prims: P, mos: 4 };
  }
  // nor2
  const pa = add(mos(40, 40, { p: true, label: M() })), pb = add(mos(56, 100, { p: true, mir: true, label: M() }));
  const na = add(mos(40, 180, { label: M() })), nb = add(mos(112, 180, { mir: true, label: M() }));
  P.push(
    line(0, 110, 10, 110), line(10, 40, 10, 180), dot(10, 110),                     // A
    line(0, -12, 142, -12), line(142, -12, 142, 180), line(86, 100, 142, 100), dot(142, 100), // B
    ...supply(48, 20), line(48, 60, 48, 80),                                         // series pull-up
    line(48, 120, 48, 160), line(48, 140, 104, 140), line(104, 140, 104, 160), dot(48, 140),
    line(104, 140, 137, 140), hop(142, 140), line(147, 140, 170, 140), dot(104, 140), // output
    ...ground(na.bot.x, na.bot.y), ...ground(nb.bot.x, nb.bot.y));
  return { w: 170, h: 212, ins: [{ x: 0, y: 110 }, { x: 0, y: -12 }], out: { x: 170, y: 140 }, prims: P, mos: 4 };
}

function bjt(kind, n) {
  const P = [];
  const add = (m) => { P.push(...m.prims); return m; };
  const Q = (x, y) => add(npn(x, y, `Q${++n.Q}`));
  const R = (x, y, v) => add(resistor(x, y, { vertical: v, label: `R${++n.R}` }));
  if (kind === 'not') {
    Q(80, 100); R(30, 100, false); R(88, 45, true);
    P.push(line(0, 100, 10, 100), line(88, 65, 88, 80), line(88, 72, 130, 72), dot(88, 72),
      ...supply(88, 25, 'VCC'), ...ground(88, 120));
    return { w: 130, h: 140, ins: [{ x: 0, y: 100 }], out: { x: 130, y: 72 }, prims: P, bjt: 1, res: 2 };
  }
  if (kind === 'nor2') {
    Q(80, 100); Q(174, 100); R(30, 100, false); R(124, 100, false); R(135, 45, true);
    P.push(line(0, 100, 10, 100),
      line(0, 150, 104, 150), line(104, 150, 104, 100),
      line(88, 80, 88, 72), line(88, 72, 182, 72), line(182, 72, 182, 80),
      line(135, 65, 135, 72), dot(135, 72), line(182, 72, 220, 72), dot(182, 72),
      ...supply(135, 25, 'VCC'), ...ground(88, 120), ...ground(182, 120));
    return { w: 220, h: 170, ins: [{ x: 0, y: 100 }, { x: 0, y: 150 }], out: { x: 220, y: 72 }, prims: P, bjt: 2, res: 3 };
  }
  // nand2: two series NPNs
  Q(80, 80); Q(80, 140); R(30, 80, false); R(30, 140, false); R(88, 25, true);
  P.push(line(0, 80, 10, 80), line(0, 140, 10, 140),
    line(88, 45, 88, 60), line(88, 52, 130, 52), dot(88, 52),
    line(88, 100, 88, 120), ...supply(88, 5, 'VCC'), ...ground(88, 160));
  return { w: 130, h: 180, ins: [{ x: 0, y: 80 }, { x: 0, y: 140 }], out: { x: 130, y: 52 }, prims: P, bjt: 2, res: 3 };
}

// Every relay's coil returns to GND; inputs hop over the GND riser at x=20.
// Cells also expose vdd / gnd entry points on the left edge for the shared rails.
function relayCell(kind, n, opts = {}) {
  const P = [];
  const K = () => `K${++n.K}`;
  const add = (m) => { P.push(...m.prims); return m; };
  const inHop = (y) => P.push(line(0, y, 15, y), hop(20, y), line(25, y, 40, y));
  // Flyback diode across the coil (pins 1-2): cathode to the signal side, anode to GND.
  const fly = (y) => { if (opts.diode) P.push(...diode(30, y), dot(30, y), dot(30, y + 20)); };
  // Rails are tagged with their net so the export can colour them (red +V, blue GND).
  const V = (...q) => P.push(...q.map((x) => ({ ...x, net: 'VDD' })));
  const G = (...q) => P.push(...q.map((x) => ({ ...x, net: 'GND' })));
  if (kind === 'not') {
    add(relay(40, 30, K()));
    inHop(40); fly(40);
    G(line(0, 10, 135, 10), line(40, 60, 20, 60), line(20, 60, 20, 10), dot(20, 10),
      line(120, 34, 135, 34), line(135, 34, 135, 10));
    V(line(0, 90, 135, 90), line(120, 66, 135, 66), line(135, 66, 135, 90));
    P.push(line(120, 50, 170, 50));
    return { w: 170, h: 100, ins: [{ x: 0, y: 40 }], out: { x: 170, y: 50 }, vdd: { x: 0, y: 90 }, gnd: { x: 0, y: 10 }, prims: P, relays: 1, diodes: opts.diode ? 1 : 0 };
  }
  add(relay(40, 30, K())); add(relay(40, 110, K()));
  inHop(40); inHop(120); fly(40); fly(120);
  if (kind === 'nand2') {
    G(line(0, 10, 135, 10), line(20, 10, 20, 140), dot(20, 10), dot(20, 60),
      line(40, 60, 20, 60), line(40, 140, 20, 140),
      line(120, 34, 135, 34), line(135, 34, 135, 10));
    P.push(line(120, 50, 130, 50), line(130, 50, 130, 114), line(130, 114, 120, 114));       // top.4 -> bottom.3
    V(line(0, 180, 145, 180), line(145, 66, 145, 180), dot(145, 146),
      line(120, 66, 125, 66), hop(130, 66), line(135, 66, 145, 66), line(120, 146, 145, 146));
    P.push(line(120, 130, 140, 130), hop(145, 130), line(150, 130, 170, 130));
    return { w: 170, h: 190, ins: [{ x: 0, y: 40 }, { x: 0, y: 120 }], out: { x: 170, y: 130 }, vdd: { x: 0, y: 180 }, gnd: { x: 0, y: 10 }, prims: P, relays: 2, diodes: opts.diode ? 2 : 0 };
  }
  // nor2
  G(line(0, 10, 135, 10), line(20, 10, 20, 170), dot(20, 10), dot(20, 60), dot(20, 140),
    line(40, 60, 20, 60), line(40, 140, 20, 140),
    line(120, 34, 135, 34), line(135, 34, 135, 10),
    line(20, 170, 145, 170), line(145, 114, 145, 170),                                        // second GND tap
    line(120, 114, 125, 114), hop(130, 114), line(135, 114, 145, 114));
  P.push(line(120, 66, 130, 66), line(130, 66, 130, 130), line(130, 130, 120, 130));         // top.5 -> bottom.4
  V(line(120, 146, 140, 146), hop(145, 146), line(150, 146, 160, 146), line(160, 146, 160, 190), line(0, 190, 160, 190));
  P.push(line(120, 50, 170, 50));
  return { w: 170, h: 200, ins: [{ x: 0, y: 40 }, { x: 0, y: 120 }], out: { x: 170, y: 50 }, vdd: { x: 0, y: 190 }, gnd: { x: 0, y: 10 }, prims: P, relays: 2, diodes: opts.diode ? 2 : 0 };
}

export function buildCell(tech, kind, names, opts = {}) {
  const c = (tech === 'relay' ? relayCell : tech === 'bjt' ? bjt : cmos)(kind, names, opts);
  const shiftPt = (p) => (p ? { x: p.x, y: p.y + TOP } : p);
  return {
    ...c,
    vdd: shiftPt(c.vdd),
    gnd: shiftPt(c.gnd),
    h: c.h + TOP,
    ins: c.ins.map((p) => ({ x: p.x, y: p.y + TOP })),
    out: { x: c.out.x, y: c.out.y + TOP },
    prims: shift(c.prims, 0, TOP),
  };
}

export { text };
