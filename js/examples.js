// Starter circuits. Each builder lays parts out on the 10px grid; wires reference pins so they
// follow the parts if they are moved. `meta.perDiv` is the scope time base to start with.
import { Circuit, snap } from './model.js';

function make(title, meta, fn) {
  const c = new Circuit();
  c.title = title;
  c.meta = meta;
  const add = (type, x, y, o) => c.add(type, x, y, o).id;
  const end = (a) => (Array.isArray(a) ? { c: a[0], p: a[1] } : a);
  const w = (a, b, o) => c.addWire(end(a), end(b), o);
  const pt = (x, y) => ({ x: snap(x), y: snap(y) });
  const probe = (x, y, label) => add('probe', x, y, { label });
  const gnd = (x, y) => add('ground', x, y);
  const vcc = (x, y, name = 'VCC') => add('vcc', x, y, { params: { name } });
  fn({ c, add, w, pt, probe, gnd, vcc });
  return c;
}

export const EXAMPLES = [
  {
    id: 'rc', name: 'RC low-pass filter',
    build: () => make('RC low-pass filter', { perDiv: 0.5e-3 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vac', 100, 200, { params: { wave: 'square', amp: 2.5, offset: 2.5, freq: 1000 } });
      const r = add('resistor', 220, 170, { params: { r: 1000 } });
      const cap = add('capacitor', 320, 200, { rot: 1, params: { c: 100e-9 } });
      w([v, 0], [r, 0]); w([r, 1], [cap, 0]);
      w([cap, 1], pt(320, 260)); gnd(320, 260);
      w([v, 1], pt(100, 260)); gnd(100, 260);
      probe(150, 170, 'IN'); probe(285, 170, 'OUT');
    }),
  },
  {
    id: 'led', name: 'LED, resistor and switch',
    build: () => make('LED, resistor and switch', { perDiv: 0.1 }, ({ add, w, pt, gnd }) => {
      const b = add('battery', 100, 200, { params: { v: 9 } });
      const sw = add('switch', 200, 170, { state: { closed: true } });
      const am = add('ammeter', 270, 170);
      const r = add('resistor', 350, 170, { params: { r: 470 } });
      const d = add('led', 410, 200, { rot: 1, params: { color: 'red' } });
      w([b, 0], [sw, 0]); w([sw, 1], [am, 0]); w([am, 1], [r, 0]); w([r, 1], [d, 0]);
      w([d, 1], pt(410, 260)); gnd(410, 260);
      w([b, 1], pt(100, 260)); gnd(100, 260);
    }),
  },
  {
    id: 'halfwave', name: 'Half-wave rectifier with filter',
    build: () => make('Half-wave rectifier', { perDiv: 0.01 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vac', 80, 200, { params: { amp: 10, freq: 50 } });
      const d = add('diode', 200, 170);
      const cap = add('ecap', 260, 200, { rot: 1, params: { c: 100e-6 } });
      const r = add('resistor', 320, 200, { rot: 1, params: { r: 1000 } });
      w([v, 0], [d, 0]); w([d, 1], [cap, 0]); w([cap, 0], [r, 0]);
      w([cap, 1], pt(260, 260)); gnd(260, 260);
      w([r, 1], pt(320, 260)); gnd(320, 260);
      w([v, 1], pt(80, 260)); gnd(80, 260);
      probe(120, 170, 'IN'); probe(290, 170, 'OUT');
    }),
  },
  {
    id: 'bridge', name: 'Full-wave bridge rectifier',
    build: () => make('Full-wave bridge rectifier', { perDiv: 0.004 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vac', 100, 200, { params: { amp: 12, freq: 50 } });
      const d1 = add('diode', 200, 120);
      const d2 = add('diode', 320, 120, { rot: 2 });
      const d3 = add('diode', 200, 280, { rot: 2 });
      const d4 = add('diode', 320, 280);
      const r = add('resistor', 260, 200, { rot: 1, params: { r: 1000 } });
      w([d1, 1], [d2, 1]);                       // + rail
      w([d3, 0], [d4, 0]);                       // - rail
      w([d1, 0], [d3, 1]);                       // AC1
      w([d2, 0], [d4, 1]);                       // AC2
      w([v, 0], pt(170, 170));
      w([v, 1], pt(350, 250), { via: [pt(100, 250)] });
      w([r, 0], pt(260, 120));
      w([r, 1], pt(260, 280));
      w(pt(260, 280), pt(260, 310)); gnd(260, 310);
      probe(135, 170, 'AC'); probe(230, 120, 'OUT');
    }),
  },
  {
    id: 'zener', name: 'Zener regulator',
    build: () => make('Zener regulator', { perDiv: 0.001 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vdc', 80, 200, { params: { v: 12 } });
      const r = add('resistor', 200, 170, { params: { r: 470 } });
      const z = add('zener', 290, 200, { rot: 3, params: { vz: 5.1 } });
      const rl = add('resistor', 370, 200, { rot: 1, params: { r: 1000 } });
      w([v, 0], [r, 0]); w([r, 1], [z, 1]); w([z, 1], [rl, 0]);
      w([z, 0], pt(290, 260)); gnd(290, 260);
      w([rl, 1], pt(370, 260)); gnd(370, 260);
      w([v, 1], pt(80, 260)); gnd(80, 260);
      probe(330, 170, 'OUT');
    }),
  },
  {
    id: 'ce', name: 'NPN common-emitter amplifier',
    build: () => make('NPN common-emitter amplifier', { perDiv: 0.5e-3 }, ({ add, w, pt, probe, gnd, vcc }) => {
      const vs = add('vdc', -60, 250, { params: { v: 12 } });
      w([vs, 0], pt(-60, 190)); vcc(-60, 190);
      w([vs, 1], pt(-60, 310)); gnd(-60, 310);
      const vin = add('vac', 20, 250, { params: { amp: 0.005, freq: 1000 } });
      const cin = add('capacitor', 100, 190, { params: { c: 1e-6 } });
      const r1 = add('resistor', 160, 130, { rot: 1, params: { r: 47000 } });
      const r2 = add('resistor', 160, 250, { rot: 1, params: { r: 10000 } });
      const q = add('npn', 260, 190);
      const rc = add('resistor', 270, 100, { rot: 1, params: { r: 2200 } });
      const re = add('resistor', 270, 260, { rot: 1, params: { r: 470 } });
      const ce = add('ecap', 330, 260, { rot: 1, params: { c: 10e-6 } });
      const co = add('capacitor', 340, 150, { params: { c: 1e-6 } });
      const rl = add('resistor', 420, 180, { rot: 1, params: { r: 10000 } });
      w([vin, 0], [cin, 0]); w([cin, 1], pt(160, 190));
      w([r1, 1], [r2, 0]); w([q, 0], pt(160, 190));
      w([r1, 0], pt(160, 70)); vcc(160, 70);
      w([r2, 1], pt(160, 320)); gnd(160, 320);
      w([rc, 0], pt(270, 40)); vcc(270, 40);
      w([rc, 1], [q, 1]);
      w([q, 2], [re, 0]); w([ce, 0], [re, 0]);
      w([re, 1], pt(270, 320)); gnd(270, 320);
      w([ce, 1], pt(330, 320)); gnd(330, 320);
      w([co, 0], pt(270, 150)); w([co, 1], [rl, 0]);
      w([rl, 1], pt(420, 240)); gnd(420, 240);
      w([vin, 1], pt(20, 310)); gnd(20, 310);
      probe(45, 190, 'IN'); probe(300, 150, 'C'); probe(390, 150, 'OUT');
    }),
  },
  {
    id: 'cmos', name: 'CMOS inverter',
    build: () => make('CMOS inverter', { perDiv: 0.5e-3 }, ({ add, w, pt, probe, gnd, vcc }) => {
      const vdd = add('vdc', -20, 190, { params: { v: 5 } });
      w([vdd, 0], pt(-20, 130)); vcc(-20, 130);
      w([vdd, 1], pt(-20, 250)); gnd(-20, 250);
      const vin = add('vac', 100, 190, { params: { wave: 'square', amp: 2.5, offset: 2.5, freq: 1000 } });
      const mp = add('pmos', 220, 120);
      const mn = add('nmos', 220, 250);
      const cl = add('capacitor', 330, 220, { rot: 1, params: { c: 10e-9 } });
      w([mp, 0], [mn, 0]);
      w([vin, 0], pt(190, 160));
      w([vin, 1], pt(100, 250)); gnd(100, 250);
      w([mp, 2], pt(230, 60)); vcc(230, 60);
      w([mn, 2], pt(230, 310)); gnd(230, 310);
      w([mp, 1], [mn, 1]);
      w(pt(230, 190), [cl, 0]);
      w([cl, 1], pt(330, 280)); gnd(330, 280);
      probe(150, 160, 'IN'); probe(280, 190, 'OUT');
    }),
  },
  {
    id: 'rlc', name: 'Series RLC ringing',
    build: () => make('Series RLC ringing', { perDiv: 0.2e-3 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vac', 80, 200, { params: { wave: 'square', amp: 2.5, offset: 2.5, freq: 500 } });
      const r = add('resistor', 200, 170, { params: { r: 20 } });
      const l = add('inductor', 290, 170, { params: { l: 10e-3, dcr: 0.1 } });
      const cap = add('capacitor', 350, 200, { rot: 1, params: { c: 1e-6 } });
      w([v, 0], [r, 0]); w([r, 1], [l, 0]); w([l, 1], [cap, 0]);
      w([cap, 1], pt(350, 260)); gnd(350, 260);
      w([v, 1], pt(80, 260)); gnd(80, 260);
      probe(120, 170, 'IN'); probe(335, 170, 'C');
    }),
  },
  {
    id: 'colpitts', name: 'LC oscillator (Colpitts)',
    build: () => make('Colpitts LC oscillator', { perDiv: 20e-6 }, ({ c, add, w, pt, probe, gnd, vcc }) => {
      const vs = add('vdc', -40, 220, { params: { v: 9 } });
      w([vs, 0], pt(-40, 160)); vcc(-40, 160);
      w([vs, 1], pt(-40, 280)); gnd(-40, 280);
      const r1 = add('resistor', 100, 110, { rot: 1, params: { r: 47000 } });
      const r2 = add('resistor', 100, 230, { rot: 1, params: { r: 22000 } });
      const q = add('npn', 220, 170);
      const ch = add('inductor', 230, 70, { rot: 1, params: { l: 10e-3, dcr: 1 } });
      const re = add('resistor', 230, 250, { rot: 1, params: { r: 470 } });
      const ce = add('capacitor', 350, 250, { rot: 1, params: { c: 1e-6 } });
      const cb = add('capacitor', 140, 150, { params: { c: 100e-9 } });
      const l = add('inductor', 360, 110, { params: { l: 1e-3, dcr: 0.5 } });
      const c1 = add('capacitor', 290, 170, { rot: 1, params: { c: 10e-9 } });
      const c2 = add('capacitor', 420, 170, { rot: 1, params: { c: 10e-9 } });
      w([r1, 0], pt(100, 80)); vcc(100, 80);
      w([ch, 0], pt(230, 20)); vcc(230, 20);
      w([r1, 1], [r2, 0]); w([r2, 1], pt(100, 260)); gnd(100, 260);
      w([q, 0], pt(100, 170));
      w([cb, 0], pt(100, 150));
      w([ch, 1], [q, 1]);
      w([q, 2], [re, 0]); w([re, 1], pt(230, 310)); gnd(230, 310);
      w([ce, 0], [re, 0]); w([ce, 1], pt(350, 310)); gnd(350, 310);
      // tank: L from the collector to Y, with C1 (collector) and C2 (Y) to ground; Y feeds the base through Cb
      w([l, 0], pt(230, 110));
      w([c1, 0], pt(290, 110)); w([c1, 1], pt(290, 270)); gnd(290, 270);
      w([l, 1], [c2, 0]); w([c2, 1], pt(420, 230)); gnd(420, 230);
      w([cb, 1], [c2, 0], { via: [pt(170, 30), pt(420, 30)] });
      probe(310, 110, 'COLL');
      c.add('probe', 130, 170, { label: 'BASE', rot: 2 });
    }),
  },
  {
    id: 'opamp', name: 'Inverting op-amp (gain -10)',
    build: () => make('Inverting op-amp', { perDiv: 0.5e-3 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vac', 80, 220, { params: { amp: 0.5, freq: 1000 } });
      const r1 = add('resistor', 180, 190, { params: { r: 1000 } });
      const rf = add('resistor', 300, 130, { params: { r: 10000 } });
      const u = add('opamp', 300, 200, { params: { vsat: 12 } });
      w([v, 0], [r1, 0]); w([r1, 1], [u, 0]);
      w([rf, 0], pt(240, 190));
      w([u, 2], pt(380, 200)); w([rf, 1], pt(380, 200));
      w([u, 1], pt(240, 210)); gnd(240, 210);
      w([v, 1], pt(80, 280)); gnd(80, 280);
      probe(115, 190, 'IN'); probe(355, 200, 'OUT');
    }),
  },
  {
    id: '555', name: '555 astable LED flasher',
    build: () => make('555 astable LED flasher', { perDiv: 0.1 }, ({ add, w, pt, gnd, vcc }) => {
      const vs = add('vdc', 60, 200, { params: { v: 5 } });
      w([vs, 0], pt(60, 140)); vcc(60, 140);
      w([vs, 1], pt(60, 260)); gnd(60, 260);
      const u = add('timer555', 300, 200);
      const r1 = add('resistor', 200, 90, { rot: 1, params: { r: 1000 } });
      const r2 = add('resistor', 200, 240, { rot: 1, params: { r: 10000 } });
      const c = add('capacitor', 230, 330, { rot: 1, params: { c: 47e-6 } });
      const r3 = add('resistor', 410, 180, { params: { r: 330 } });
      const d = add('led', 470, 210, { rot: 1, params: { color: 'green' } });
      w([r1, 0], pt(200, 30)); vcc(200, 30);
      w([r1, 1], [r2, 0]);
      w([u, 6], pt(200, 180));
      w([u, 5], [r2, 1], { via: [pt(230, 200), pt(230, 270)] });
      w([u, 1], pt(230, 220));
      w([c, 0], pt(230, 270));
      w([c, 1], pt(230, 390)); gnd(230, 390);
      w([u, 7], pt(300, 130)); vcc(300, 130);
      w([u, 0], pt(300, 270)); gnd(300, 270);
      w([u, 2], [r3, 0]); w([r3, 1], [d, 0]);
      w([d, 1], pt(470, 270)); gnd(470, 270);
    }),
  },
  {
    id: 'fuse', name: 'Fuse protecting a lamp',
    build: () => make('Fuse protecting a lamp', { perDiv: 0.02 }, ({ add, w, pt, probe, gnd }) => {
      const b = add('battery', 100, 200, { params: { v: 12, r: 0.05 } });
      const sw = add('switch', 200, 170);
      const f = add('fuse', 290, 170, { params: { rating: 2 } });
      const l = add('lamp', 380, 200, { rot: 1, params: { v: 12, w: 36 } });
      w([b, 0], [sw, 0]); w([sw, 1], [f, 0]); w([f, 1], [l, 0]);
      w([l, 1], pt(380, 260)); gnd(380, 260);
      w([b, 1], pt(100, 260)); gnd(100, 260);
      probe(345, 170, 'LAMP');
    }),
  },
  {
    id: 'xfmr', name: 'Step-down transformer',
    build: () => make('Step-down transformer', { perDiv: 0.004 }, ({ add, w, pt, probe, gnd }) => {
      const v = add('vac', 80, 200, { params: { amp: 20, freq: 50 } });
      const t = add('transformer', 200, 200, { params: { n: 4, lp: 0.5 } });
      const rl = add('resistor', 300, 200, { rot: 1, params: { r: 100 } });
      w([v, 0], [t, 0]); w([v, 1], [t, 1]);
      w([t, 2], [rl, 0]); w([t, 3], [rl, 1]);
      w([v, 1], pt(80, 260)); gnd(80, 260);
      w([rl, 1], pt(300, 260)); gnd(300, 260);
      probe(125, 180, 'PRI'); probe(265, 180, 'SEC');
    }),
  },
];
