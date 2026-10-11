// Transient circuit simulator: modified nodal analysis, Newton-Raphson for the nonlinear
// parts, trapezoidal (or backward Euler) integration. DOM free.
//
// Reactive parts start discharged, so pressing Run shows the real charge-up behaviour.
// The models are educational grade (Ebers-Moll BJT, square-law MOSFET and JFET, ideal-ish
// op-amp with output clamp); they are not a substitute for a full SPICE run.
import { LED_VF } from './model.js';

const VT = 0.025852;
const GMIN = 1e-9;
const expc = (x) => Math.exp(Math.max(-80, Math.min(80, x)));

function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else vnew = vt * Math.log(vnew / vt);
  } else if (vnew < 0) {
    const arg = vold > 0 ? -vold - 1 : 2 * vold - 1;
    if (vnew < arg) vnew = arg;
  }
  return vnew;
}
const lim = (vnew, vold, step) => Math.max(vold - step, Math.min(vold + step, vnew));

// ---- waveforms ---------------------------------------------------------------
export function waveValue(p, t) {
  const ph = (p.freq * t + (p.phase || 0) / 360);
  const f = ph - Math.floor(ph);
  let w;
  switch (p.wave) {
    case 'square': w = f < (p.duty ?? 50) / 100 ? 1 : -1; break;
    case 'tri': w = f < 0.5 ? 4 * f - 1 : 3 - 4 * f; break;
    case 'saw': w = 2 * f - 1; break;
    default: w = Math.sin(2 * Math.PI * ph);
  }
  return (p.offset || 0) + p.amp * w;
}

// ---- elements ---------------------------------------------------------------
// Each element stamps itself into the shared system every Newton iteration.
// s.G(a,b,g)        conductance between nets
// s.inj(n,i)        current injected into a net
// s.nlStamp(...)    linearised nonlinear current into terminals
class El {
  constructor(e, s) {
    this.e = e; this.s = s; this.id = e.id; this.n = e.nets; this.p = e.p;
    this.st = s.store.get(e.id) || {};
    s.store.set(e.id, this.st);
    this.nb = 0; this.b = 0; this.info = {};
  }
  stamp() {}
  accept() { return false; }
}

class Resistor extends El {
  stamp() { this.s.G(this.n[0], this.n[1], 1 / Math.max(this.p.r, 1e-9)); }
  accept() { const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]); this.info = { v, i: v / this.p.r }; }
}

class Fixed extends El {   // lamp, speaker, voltmeter: constant resistance
  constructor(e, s, r) { super(e, s); this.r = r; }
  stamp() { this.s.G(this.n[0], this.n[1], 1 / this.r); }
  accept() {
    const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]);
    this.info = { v, i: v / this.r };
    if (this.e.type === 'lamp') this.info.glow = Math.min(1.5, (v * v / this.r) / this.p.w);
  }
}

class Pot extends El {
  stamp() {
    const w = Math.min(0.999, Math.max(0.001, this.p.w / 100)), R = this.p.r;
    this.s.G(this.n[0], this.n[2], 1 / (R * (1 - w)));
    this.s.G(this.n[2], this.n[1], 1 / (R * w));
  }
  accept() {
    const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]);
    this.info = { v, i: v / this.p.r, vw: s.v(this.n[2]) };
  }
}

class Capacitor extends El {
  stamp() {
    const s = this.s, C = this.p.c, g = (s.be ? 1 : 2) * C / s.dt;
    const vn = this.st.v || 0, inn = s.be ? 0 : this.st.i || 0;
    const ieq = g * vn + inn;
    s.G(this.n[0], this.n[1], g);
    s.inj(this.n[0], ieq);
    s.inj(this.n[1], -ieq);
    this.g = g; this.ieq = ieq;
  }
  accept() {
    const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]);
    this.st.i = this.g * v - this.ieq;
    this.st.v = v;
    this.info = { v, i: this.st.i };
  }
}

// Inductor with series resistance; also used for motors and relay coils.
class Inductor extends El {
  constructor(e, s, L, r) { super(e, s); this.L = L; this.r = r; this.nb = 1; }
  stamp() {
    const s = this.s, k = this.b, a = this.n[0], b = this.n[1];
    const c = (s.be ? 1 : 2) / s.dt;
    s.branch(a, b, k);
    s.A_(k, k, -(this.r + c * this.L));
    s.B_(k, -(c * (this.st.lam || 0) + (s.be ? 0 : this.st.vl || 0)));
  }
  accept() {
    const s = this.s, i = s.x[this.b], v = s.v(this.n[0]) - s.v(this.n[1]);
    this.st.lam = this.L * i;
    this.st.vl = v - this.r * i;
    this.info = { v, i };
  }
}

class Transformer extends El {
  constructor(e, s) {
    super(e, s); this.nb = 2;
    const p = e.p;
    this.L1 = p.lp; this.L2 = p.lp / (p.n * p.n);
    this.M = p.k * Math.sqrt(this.L1 * this.L2);
    this.r1 = p.rp; this.r2 = p.rp / (p.n * p.n);
  }
  stamp() {
    const s = this.s, c = (s.be ? 1 : 2) / s.dt, k1 = this.b, k2 = this.b + 1;
    s.branch(this.n[0], this.n[1], k1);
    s.branch(this.n[2], this.n[3], k2);
    s.A_(k1, k1, -(this.r1 + c * this.L1)); s.A_(k1, k2, -c * this.M);
    s.A_(k2, k2, -(this.r2 + c * this.L2)); s.A_(k2, k1, -c * this.M);
    const tr = s.be ? 0 : 1;
    s.B_(k1, -(c * (this.st.l1 || 0) + tr * (this.st.v1 || 0)));
    s.B_(k2, -(c * (this.st.l2 || 0) + tr * (this.st.v2 || 0)));
  }
  accept() {
    const s = this.s, i1 = s.x[this.b], i2 = s.x[this.b + 1];
    const v1 = s.v(this.n[0]) - s.v(this.n[1]), v2 = s.v(this.n[2]) - s.v(this.n[3]);
    this.st.l1 = this.L1 * i1 + this.M * i2; this.st.l2 = this.L2 * i2 + this.M * i1;
    this.st.v1 = v1 - this.r1 * i1; this.st.v2 = v2 - this.r2 * i2;
    this.info = { v: v1, i: i1, v2, i2 };
  }
}

class VSource extends El {
  constructor(e, s) { super(e, s); this.nb = 1; }
  value() {
    const p = this.p, s = this.s;
    switch (this.e.type) {
      case 'vac': return waveValue(p, s.tNew);
      case 'ammeter': return 0;
      default: return p.v;
    }
  }
  stamp() {
    const s = this.s;
    s.branch(this.n[0], this.n[1], this.b);
    if (this.e.type === 'battery') s.A_(this.b, this.b, -Math.max(this.p.r, 0));
    s.B_(this.b, this.value());
  }
  accept() {
    const s = this.s, i = s.x[this.b], v = s.v(this.n[0]) - s.v(this.n[1]);
    // The branch variable is the current entering the + pin; show it flowing out of + as a source does.
    this.info = { v, i: -i, p: -i * v };
    if (this.e.type === 'ammeter') this.info = { v: 0, i };
  }
}

class ISource extends El {
  stamp() { this.s.inj(this.n[0], -this.p.i); this.s.inj(this.n[1], this.p.i); }
  accept() { this.info = { v: this.s.v(this.n[0]) - this.s.v(this.n[1]), i: this.p.i }; }
}

class Switch extends El {
  closed() { return !!this.e.st.closed; }
  stamp() { this.s.G(this.n[0], this.n[1], this.closed() ? 100 : GMIN); }
  accept() {
    const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]);
    this.info = { v, i: this.closed() ? v * 100 : 0 };
  }
}

class Spdt extends El {
  stamp() {
    const up = !this.e.st.pos;
    this.s.G(this.n[0], this.n[1], up ? 100 : GMIN);
    this.s.G(this.n[0], this.n[2], up ? GMIN : 100);
  }
  accept() { this.info = { v: this.s.v(this.n[0]) - this.s.v(this.n[1]) }; }
}

class Fuse extends El {
  stamp() {
    const blown = this.st.blown ?? this.e.st.blown;
    this.s.G(this.n[0], this.n[1], blown ? GMIN : 1 / this.p.r);
  }
  accept() {
    const s = this.s, st = this.st;
    if (st.blown === undefined) st.blown = !!this.e.st.blown;
    if (st.heat === undefined) st.heat = this.e.st.heat || 0;
    const v = s.v(this.n[0]) - s.v(this.n[1]);
    const i = st.blown ? 0 : v / this.p.r;
    let ev = false;
    if (!st.blown) {
      const ir = this.p.rating;
      st.heat = Math.max(0, st.heat + (i * i / (ir * ir) - 1) * s.dt / 0.1);
      if (st.heat >= 1) { st.blown = true; st.heat = 1; ev = true; }
    }
    this.e.st.blown = st.blown;
    this.e.st.heat = st.heat;
    this.info = { v, i, heat: st.heat, blown: st.blown };
    return ev;
  }
}

// Junction diode (plain, Schottky, Zener, LED) with SPICE style voltage limiting.
class Diode extends El {
  constructor(e, s) {
    super(e, s); this.nl = true;
    const p = e.p;
    if (e.type === 'led') { this.nn = 2; this.is = 0.01 * Math.exp(-LED_VF[p.color] / (2 * VT)); }
    else if (e.type === 'zener') { this.nn = 1; this.is = 1e-14; this.vz = p.vz; }
    else { this.nn = p.n; this.is = p.is; }
    this.vcrit = this.nn * VT * Math.log(this.nn * VT / (Math.SQRT2 * this.is));
  }
  eval(v) {
    const nvt = this.nn * VT;
    const ex = expc(v / nvt);
    let i = this.is * (ex - 1), g = this.is * ex / nvt;
    if (this.vz) {
      const eb = expc(-(v + this.vz) / VT) * 1e-3;
      i -= eb; g += eb / VT;
    }
    return [i + GMIN * v, g + GMIN];
  }
  stamp() {
    const s = this.s, a = this.n[0], k = this.n[1];
    const vold = this.st.vd ?? 0;
    const vd = pnjlim(s.v(a) - s.v(k), vold, this.nn * VT, this.vcrit);
    if (Math.abs(vd - (s.v(a) - s.v(k))) > 1e-9) s.noncon = true;
    this.st.vd = vd;
    const [i, g] = this.eval(vd);
    s.nlStamp([a, k], [i, -i], [[g, -g], [-g, g]], [vd, 0]);
    this.cur = i;
  }
  accept() {
    const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]);
    const [i] = this.eval(v);
    this.info = { v, i };
    if (this.e.type === 'led') this.info.glow = Math.min(1.3, Math.max(0, i) / 0.02);
  }
}

class Scr extends El {
  constructor(e, s) { super(e, s); this.nl = true; this.vcrit = 0.7; }
  stamp() {
    const s = this.s, [a, k, g] = this.n;
    s.G(g, k, 1 / 100);                // gate: resistor in series with the gate junction
    if (!this.st.on) { s.G(a, k, GMIN); return; }
    const vold = this.st.vd ?? 0.7;
    const vd = pnjlim(s.v(a) - s.v(k), vold, 1.5 * VT, 0.7);
    if (Math.abs(vd - (s.v(a) - s.v(k))) > 1e-9) s.noncon = true;
    this.st.vd = vd;
    const nvt = 1.5 * VT, is = 1e-12, ex = expc(vd / nvt);
    const i = is * (ex - 1), gd = is * ex / nvt + GMIN;
    s.nlStamp([a, k], [i, -i], [[gd, -gd], [-gd, gd]], [vd, 0]);
  }
  accept() {
    const s = this.s, v = s.v(this.n[0]) - s.v(this.n[1]);
    const vg = s.v(this.n[2]) - s.v(this.n[1]);
    if (this.st.on === undefined) this.st.on = !!this.e.st.on;
    const i = 1e-12 * (expc(v / (1.5 * VT)) - 1);
    let ev = false;
    if (!this.st.on) {
      if (v > 0.5 && vg > this.p.vgt) { this.st.on = true; ev = true; }
    } else if (i < this.p.ih || v < 0) { this.st.on = false; ev = true; }
    this.e.st.on = this.st.on;
    this.info = { v, i: this.st.on ? i : 0, on: this.st.on };
    return ev;
  }
}

class Bjt extends El {
  constructor(e, s) {
    super(e, s); this.nl = true;
    this.pol = e.type === 'npn' ? 1 : -1;
    this.vcrit = VT * Math.log(VT / (Math.SQRT2 * e.p.is));
  }
  // returns terminal currents and partials for junction voltages (vbe, vbc)
  eval(vbe, vbc) {
    const { bf, is, vaf } = this.p, br = 4;
    const ef = expc(vbe / VT), er = expc(vbc / VT);
    const If = is * (ef - 1), Ir = is * (er - 1);
    const gf = is * ef / VT, gr = is * er / VT;
    const E = 1 + (vbe - vbc) / vaf;
    const It = (If - Ir) * E;
    const dItbe = gf * E + (If - Ir) / vaf, dItbc = -gr * E - (If - Ir) / vaf;
    const ic = It - Ir / br, ib = If / bf + Ir / br;
    return {
      ic: ic + GMIN * (vbe - vbc), ib: ib + GMIN * vbe,
      icbe: dItbe + GMIN, icbc: dItbc - gr / br - GMIN, ibbe: gf / bf + GMIN, ibbc: gr / br,
    };
  }
  stamp() {
    const s = this.s, [B, C, E] = this.n, pol = this.pol;
    let vbe = pol * (s.v(B) - s.v(E)), vbc = pol * (s.v(B) - s.v(C));
    const ob = this.st.vbe ?? 0, oc = this.st.vbc ?? 0;
    const lbe = pnjlim(vbe, ob, VT, this.vcrit), lbc = pnjlim(vbc, oc, VT, this.vcrit);
    if (Math.abs(lbe - vbe) > 1e-9 || Math.abs(lbc - vbc) > 1e-9) s.noncon = true;
    this.st.vbe = lbe; this.st.vbc = lbc;
    const r = this.eval(lbe, lbc);
    // terminal currents entering the device: collector, base, emitter
    const Ic = pol * r.ic, Ib = pol * r.ib, Ie = -(Ic + Ib);
    // d/d(vB, vC, vE): vbe = pol*(vB-vE), vbc = pol*(vB-vC)
    const row = (dbe, dbc) => [dbe + dbc, -dbc, -dbe];     // order B, C, E
    const gc = row(r.icbe, r.icbc), gb = row(r.ibbe, r.ibbc);
    const ge = gc.map((v, j) => -(v + gb[j]));
    const ve = s.v(E), vb = ve + pol * lbe, vc = vb - pol * lbc;
    s.nlStamp([C, B, E], [Ic, Ib, Ie],
      [[gc[1], gc[0], gc[2]], [gb[1], gb[0], gb[2]], [ge[1], ge[0], ge[2]]], [vc, vb, ve]);
  }
  accept() {
    const s = this.s, [B, C, E] = this.n, pol = this.pol;
    const r = this.eval(pol * (s.v(B) - s.v(E)), pol * (s.v(B) - s.v(C)));
    this.info = { v: s.v(C) - s.v(E), vbe: s.v(B) - s.v(E), i: pol * r.ic, ib: pol * r.ib };
  }
}

// Square-law MOSFET (level 1) with optional body diode; terminals [G, D, S].
class Mos extends El {
  constructor(e, s) {
    super(e, s); this.nl = true;
    this.pol = e.type === 'nmos' ? 1 : -1;
    this.bd = e.p.body ? new Diode({ id: e.id + ':bd', type: 'diode', nets: [], p: { is: 1e-11, n: 1.2 } }, s) : null;
  }
  fwd(vgs, vds) {   // vds >= 0
    const { vth, kp, lambda } = this.p, vov = vgs - vth;
    if (vov <= 0) return [0, 0, 0];
    const cl = 1 + lambda * vds;
    if (vds < vov) {
      const i0 = kp * (vov * vds - vds * vds / 2);
      return [i0 * cl, kp * vds * cl, kp * (vov - vds) * cl + i0 * lambda];
    }
    const i0 = kp / 2 * vov * vov;
    return [i0 * cl, kp * vov * cl, i0 * lambda];
  }
  // current drain->source and its partials wrt vgs, vds, for any sign of vds
  eval(vgs, vds) {
    if (vds >= 0) { const [i, gm, gds] = this.fwd(vgs, vds); return [i, gm, gds]; }
    const [i, gm, gds] = this.fwd(vgs - vds, -vds);
    return [-i, -gm, gm + gds];
  }
  stamp() {
    const s = this.s, [G, D, S] = this.n, pol = this.pol;
    let vgs = pol * (s.v(G) - s.v(S)), vds = pol * (s.v(D) - s.v(S));
    const lg = lim(vgs, this.st.vgs ?? 0, 1.5), ld = lim(vds, this.st.vds ?? 0, 3);
    if (lg !== vgs || ld !== vds) s.noncon = true;
    this.st.vgs = vgs = lg; this.st.vds = vds = ld;
    const [i, gm, gds] = this.eval(vgs, vds);
    const Id = pol * i;
    const gmm = gm, gdd = gds + GMIN;
    const vs = s.v(S), vg = vs + pol * vgs, vd = vs + pol * vds;
    // rows: G (no current), D, S
    s.nlStamp([G, D, S], [0, Id + GMIN * pol * vds, -(Id + GMIN * pol * vds)],
      [[0, 0, 0], [gmm, gdd, -(gmm + gdd)], [-gmm, -gdd, gmm + gdd]], [vg, vd, vs]);
    if (this.bd) {
      // body diode runs from source to drain for N, drain to source for P
      const [a, k] = pol > 0 ? [S, D] : [D, S];
      this.bd.n = [a, k];
      this.bd.stamp();
    }
  }
  accept() {
    const s = this.s, [G, D, S] = this.n, pol = this.pol;
    const [i] = this.eval(pol * (s.v(G) - s.v(S)), pol * (s.v(D) - s.v(S)));
    this.info = { v: s.v(D) - s.v(S), vgs: s.v(G) - s.v(S), i: pol * i };
  }
}

class Jfet extends El {
  constructor(e, s) { super(e, s); this.nl = true; this.pol = e.type === 'njfet' ? 1 : -1; }
  fwd(vgs, vds) {
    const vov = vgs - this.pol * this.p.vto, { beta, lambda } = this.p;
    if (vov <= 0) return [0, 0, 0];
    const cl = 1 + lambda * vds;
    if (vds < vov) {
      const i0 = beta * vds * (2 * vov - vds);
      return [i0 * cl, 2 * beta * vds * cl, beta * (2 * vov - 2 * vds) * cl + i0 * lambda];
    }
    const i0 = beta * vov * vov;
    return [i0 * cl, 2 * beta * vov * cl, i0 * lambda];
  }
  eval(vgs, vds) {
    if (vds >= 0) return this.fwd(vgs, vds);
    const [i, gm, gds] = this.fwd(vgs - vds, -vds);
    return [-i, -gm, gm + gds];
  }
  stamp() {
    const s = this.s, [G, D, S] = this.n, pol = this.pol;
    let vgs = pol * (s.v(G) - s.v(S)), vds = pol * (s.v(D) - s.v(S));
    const lg = lim(vgs, this.st.vgs ?? 0, 1.5), ld = lim(vds, this.st.vds ?? 0, 3);
    if (lg !== vgs || ld !== vds) s.noncon = true;
    this.st.vgs = vgs = lg; this.st.vds = vds = ld;
    const [i, gm, gds] = this.eval(vgs, vds);
    const Id = pol * i, gmm = gm + GMIN, gdd = gds + GMIN;
    const vs = s.v(S), vg = vs + pol * vgs, vd = vs + pol * vds;
    s.nlStamp([G, D, S], [0, Id, -Id],
      [[0, 0, 0], [gmm, gdd, -(gmm + gdd)], [-gmm, -gdd, gmm + gdd]], [vg, vd, vs]);
  }
  accept() {
    const s = this.s, [G, D, S] = this.n, pol = this.pol;
    const [i] = this.eval(pol * (s.v(G) - s.v(S)), pol * (s.v(D) - s.v(S)));
    this.info = { v: s.v(D) - s.v(S), vgs: s.v(G) - s.v(S), i: pol * i };
  }
}

// Op-amp: high gain VCVS with output resistance, solved as three regions
// (linear, +rail, -rail) so feedback circuits converge without fighting the clamp.
class OpAmp extends El {
  constructor(e, s) { super(e, s); this.nl = true; this.ro = 10; }
  stamp() {
    const s = this.s, [m, p, o] = this.n, reg = this.st.reg || 0, g = 1 / this.ro;
    s.G(o, 0, g);
    if (reg === 0) {
      const gm = this.p.gain * g;
      s.A_n(o, p, -gm); s.A_n(o, m, gm);
    } else s.inj(o, reg * this.p.vsat * g);
  }
  accept() { return false; }
  post() {   // called inside the Newton loop after each solve
    const s = this.s, [m, p, o] = this.n;
    const vd = s.v(p) - s.v(m), y = this.p.gain * vd, vs = this.p.vsat;
    const want = Math.abs(y) <= vs ? 0 : Math.sign(y);
    const reg = this.st.reg || 0;
    this.info = { v: s.v(o), vd, i: (s.v(o) - 0) / 1e9 };
    if (want !== reg) {
      // hysteresis against chatter right at the knee
      if (reg === 0 || Math.abs(y) > vs * 1.0001 || want === 0) { this.st.reg = want; return true; }
    }
    return false;
  }
}

class Relay extends El {
  constructor(e, s) { super(e, s); this.coil = new Inductor({ ...e, id: e.id + ':c', nets: [e.nets[0], e.nets[1]], p: {} }, s, e.p.lcoil, e.p.rcoil); this.nb = 1; }
  init() { this.coil.b = this.b; }
  stamp() {
    this.coil.stamp();
    const on = this.e.st.on, [, , nc, com, no] = this.n;
    this.s.G(com, nc, on ? GMIN : 100);
    this.s.G(com, no, on ? 100 : GMIN);
  }
  accept() {
    this.coil.accept();
    const s = this.s, vc = Math.abs(s.v(this.n[0]) - s.v(this.n[1]));
    const was = this.e.st.on;
    const p = this.p.vpull;
    if (!was && vc >= p) this.e.st.on = true;
    else if (was && vc < 0.3 * p) this.e.st.on = false;
    this.info = { v: vc, i: this.coil.info.i, on: this.e.st.on };
    return was !== this.e.st.on;
  }
}

class Timer555 extends El {
  constructor(e, s) { super(e, s); this.nl = false; }
  // pins: 0 GND, 1 TRIG, 2 OUT, 3 RESET, 4 CTRL, 5 THR, 6 DIS, 7 VCC
  stamp() {
    const s = this.s, n = this.n, q = this.st.q ?? this.e.st.q ?? 0;
    const gnd = n[0], vcc = n[7];
    s.G(vcc, n[4], 1 / 5000);
    s.G(n[4], gnd, 1 / 10000);
    s.G(vcc, n[3], 1 / 100000);
    const powered = s.v(vcc) - s.v(gnd) > 3;
    const hi = (s.v(vcc) - s.v(gnd)) - 1.7;
    const target = powered && q ? Math.max(hi, 0) : 0.1;
    const g = 1 / 15;
    s.G(n[2], gnd, g);
    s.inj(n[2], target * g);
    s.inj(gnd, -target * g);
    s.G(n[6], gnd, q ? GMIN : 1 / 10);
  }
  accept() {
    const s = this.s, n = this.n, g = s.v(n[0]);
    const vcc = s.v(n[7]) - g, ctrl = s.v(n[4]) - g;
    const thr = s.v(n[5]) - g, trig = s.v(n[1]) - g, rst = s.v(n[3]) - g;
    const old = this.st.q ?? this.e.st.q ?? 0;
    let q = old;
    if (vcc < 3 || rst < 0.4) q = 0;
    else if (trig < ctrl / 2) q = 1;
    else if (thr > ctrl) q = 0;
    this.st.q = q; this.e.st.q = q;
    this.info = { v: s.v(n[2]) - g, q, vcc };
    return q !== old;
  }
}

function make(e, s) {
  switch (e.type) {
    case 'resistor': return new Resistor(e, s);
    case 'pot': return new Pot(e, s);
    case 'capacitor': case 'ecap': return new Capacitor(e, s);
    case 'inductor': return new Inductor(e, s, e.p.l, e.p.dcr);
    case 'motor': return new Inductor(e, s, e.p.l, e.p.r);
    case 'transformer': return new Transformer(e, s);
    case 'vdc': case 'vac': case 'battery': case 'ammeter': return new VSource(e, s);
    case 'idc': return new ISource(e, s);
    case 'switch': case 'button': return new Switch(e, s);
    case 'spdt': return new Spdt(e, s);
    case 'relay': return new Relay(e, s);
    case 'fuse': return new Fuse(e, s);
    case 'diode': case 'schottky': case 'zener': case 'led': return new Diode(e, s);
    case 'scr': return new Scr(e, s);
    case 'npn': case 'pnp': return new Bjt(e, s);
    case 'nmos': case 'pmos': return new Mos(e, s);
    case 'njfet': case 'pjfet': return new Jfet(e, s);
    case 'opamp': return new OpAmp(e, s);
    case 'timer555': return new Timer555(e, s);
    case 'lamp': return new Fixed(e, s, Math.max(e.p.v * e.p.v / e.p.w, 1e-3));
    case 'speaker': return new Fixed(e, s, Math.max(e.p.r, 1e-3));
    case 'voltmeter': return new Fixed(e, s, 1e7);
    default: return null;
  }
}

// ---- the simulator ----------------------------------------------------------
export class Sim {
  // nl: result of buildNetlist. store: Map persisting element state across rebuilds.
  constructor(nl, store = new Map(), opts = {}) {
    this.nl = nl; this.store = store;
    // Trapezoidal keeps LC circuits from damping artificially; plain RC and switching circuits are
    // steadier (no ringing across hard edges) with backward Euler.
    const m = opts.method || 'auto';
    this.method = m !== 'auto' ? m : nl.elems.some((e) => e.type === 'inductor' || e.type === 'transformer' || e.type === 'motor') ? 'trap' : 'be';
    this.nv = nl.nNets - 1;
    this.t = 0; this.tNew = 0; this.dt = 1e-6; this.be = true;
    this.nonconv = 0;
    this.els = [];
    let nb = 0;
    for (const e of nl.elems) {
      const el = make(e, this);
      if (!el) continue;
      el.b = this.nv + nb; nb += el.nb;
      el.init?.();
      this.els.push(el);
    }
    this.N = this.nv + nb;
    this.A = new Float64Array(this.N * this.N);
    this.bv = new Float64Array(this.N);
    this.W = new Float64Array(this.N * this.N);
    this.x = new Float64Array(this.N);
    this.hasNL = this.els.some((e) => e.nl);
    this.forceBE = true;
    this.byId = new Map(this.els.map((e) => [e.id, e]));
  }

  v(n) { return n > 0 ? this.x[n - 1] : 0; }

  // -- stamping helpers (net numbers; 0 is ground)
  G(a, b, g) {
    const N = this.N, A = this.A;
    if (a > 0) A[(a - 1) * N + a - 1] += g;
    if (b > 0) A[(b - 1) * N + b - 1] += g;
    if (a > 0 && b > 0) { A[(a - 1) * N + b - 1] -= g; A[(b - 1) * N + a - 1] -= g; }
  }
  inj(n, i) { if (n > 0) this.bv[n - 1] += i; }
  A_n(r, c, v) { if (r > 0 && c > 0) this.A[(r - 1) * this.N + c - 1] += v; }
  A_(r, c, v) { this.A[r * this.N + c] += v; }
  B_(r, v) { this.bv[r] += v; }
  // branch k: current i_k leaves net a, enters net b through the element; row k says va - vb = ...
  branch(a, b, k) {
    const N = this.N, A = this.A;
    if (a > 0) { A[(a - 1) * N + k] += 1; A[k * N + a - 1] += 1; }
    if (b > 0) { A[(b - 1) * N + k] -= 1; A[k * N + b - 1] -= 1; }
  }
  // Terminals draw I0[r] out of net[r]; G is the Jacobian, v0 the operating point it was taken at.
  nlStamp(nets, I0, Gm, v0) {
    const N = this.N;
    for (let r = 0; r < nets.length; r++) {
      const nr = nets[r];
      if (nr <= 0) continue;
      let c0 = I0[r];
      for (let c = 0; c < nets.length; c++) {
        c0 -= Gm[r][c] * v0[c];
        if (nets[c] > 0) this.A[(nr - 1) * N + nets[c] - 1] += Gm[r][c];
      }
      this.bv[nr - 1] -= c0;
    }
  }

  solve() {
    const N = this.N, A = this.W, b = this.bv;
    A.set(this.A);
    for (let c = 0; c < N; c++) {
      let p = c, m = Math.abs(A[c * N + c]);
      for (let r = c + 1; r < N; r++) { const a = Math.abs(A[r * N + c]); if (a > m) { m = a; p = r; } }
      if (m < 1e-300) return false;
      if (p !== c) {
        for (let k = c; k < N; k++) { const t = A[c * N + k]; A[c * N + k] = A[p * N + k]; A[p * N + k] = t; }
        const t = b[c]; b[c] = b[p]; b[p] = t;
      }
      const d = A[c * N + c];
      for (let r = c + 1; r < N; r++) {
        const f = A[r * N + c] / d;
        if (f === 0) continue;
        for (let k = c + 1; k < N; k++) A[r * N + k] -= f * A[c * N + k];
        b[r] -= f * b[c];
      }
    }
    for (let r = N - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < N; k++) s -= A[r * N + k] * b[k];
      b[r] = s / A[r * N + r];
    }
    return true;
  }

  // One Newton solve at the current dt / time. Returns true on convergence.
  newton() {
    const N = this.N, maxIt = this.hasNL ? 60 : 1;
    for (let it = 0; it < maxIt; it++) {
      this.A.fill(0); this.bv.fill(0); this.noncon = false;
      for (let i = 0; i < this.nv; i++) this.A[i * N + i] += GMIN;
      for (const e of this.els) e.stamp();
      if (!this.solve()) return false;
      let ok = true;
      for (let i = 0; i < N; i++) {
        const xn = this.bv[i];
        if (!Number.isFinite(xn)) return false;
        const d = Math.abs(xn - this.x[i]);
        if (d > 1e-6 + 1e-4 * Math.max(Math.abs(xn), Math.abs(this.x[i]))) ok = false;
        this.x[i] = xn;
      }
      let flipped = false;
      for (const e of this.els) if (e.post && e.post()) flipped = true;
      if (!this.hasNL) return true;
      if (ok && !this.noncon && !flipped) return true;
    }
    return false;
  }

  // Advance by dt, halving the step when Newton fails.
  step(dt) {
    let rem = dt, h = dt, guard = 0;
    while (rem > dt * 1e-9 && guard++ < 400) {
      h = Math.min(h, rem);
      const keep = this.x.slice();
      this.dt = h; this.tNew = this.t + h;
      this.be = this.forceBE || this.method === 'be';
      let ok = this.newton();
      if (!ok && h > dt / 128) { this.x.set(keep); h /= 2; continue; }
      if (!ok) this.nonconv++;
      this.t = this.tNew;
      let ev = false;
      for (const e of this.els) if (e.accept()) ev = true;
      this.forceBE = ev;
      rem -= h;
      if (h < rem) h = Math.min(rem, h * 2);
    }
  }

  nodeV(n) { return this.v(n); }
  info(id) { return this.byId.get(id)?.info; }
}

// Pick a timestep that resolves the fastest thing in the circuit.
export function autoStep(nl) {
  let dt = 1e-3;
  let rmin = Infinity;
  for (const e of nl.elems) if (e.type === 'resistor') rmin = Math.min(rmin, e.p.r);
  const r = Number.isFinite(rmin) ? Math.max(rmin, 10) : 1000;
  for (const e of nl.elems) {
    const p = e.p;
    if (e.type === 'vac') dt = Math.min(dt, 1 / (Math.max(p.freq, 1e-3) * 200));
    else if (e.type === 'capacitor' || e.type === 'ecap') dt = Math.min(dt, Math.max(p.c * r / 20, 1e-9));
    else if (e.type === 'inductor' || e.type === 'motor') dt = Math.min(dt, Math.max(p.l / r / 20, 1e-9));
    else if (e.type === 'relay') dt = Math.min(dt, 1e-3);
    else if (e.type === 'timer555') dt = Math.min(dt, 2e-4);
  }
  const Ls = nl.elems.filter((e) => e.type === 'inductor'), Cs = nl.elems.filter((e) => e.type === 'capacitor' || e.type === 'ecap');
  for (const l of Ls) for (const c of Cs) dt = Math.min(dt, Math.max(2 * Math.PI * Math.sqrt(l.p.l * c.p.c) / 80, 1e-9));
  return Math.max(dt, 1e-9);
}

// Width of the scope window: a few cycles of the slowest source, else a fixed number of steps.
export function autoSpan(nl, dt) {
  const f = nl.elems.filter((e) => e.type === 'vac').map((e) => e.p.freq);
  if (f.length) return Math.max(5 / Math.min(...f), 50 * dt);
  return 1000 * dt;
}
