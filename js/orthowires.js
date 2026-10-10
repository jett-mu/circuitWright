// Straight (orthogonal) wires with separated tracks for the gate-level export.
// Each net gets a vertical trunk; trunks/lanes slide sideways so wires of
// different nets never share a line. Crossings are resolved by wirePrims().
import { pinPos } from './model.js';
import { MIN_GAP } from './schematic.js';

export function routeOrtho(circ) {
  const at = (e, side) => {
    if (e.c === undefined) return { x: e.x, y: e.y };
    const c = circ.get(e.c);
    return c ? pinPos(c, side, e.p) : null;
  };
  const nets = new Map();
  const ends = [];
  for (const w of circ.wires) {
    const a = at(w.from, 'out'), b = at(w.to, 'in');
    if (!a || !b) continue;
    const key = w.from.c !== undefined ? `${w.from.c}:${w.from.p}` : `f${w.id}`;
    if (!nets.has(key)) nets.set(key, { key, a, sinks: [] });
    nets.get(key).sinks.push({ w, b });
    if (w.from.c === undefined) ends.push({ x: a.x, y: a.y, net: key });
    if (w.to.c === undefined) ends.push({ x: b.x, y: b.y, net: key });
  }

  const segs = [];
  // Rows where pin stubs will run (known up front): keep other wires' horizontals off them.
  const rows = [];
  for (const n of nets.values()) {
    rows.push({ net: n.key, y: n.a.y, x0: n.a.x, x1: n.a.x + 120 });
    for (const s of n.sinks) rows.push({ net: n.key, y: s.b.y, x0: s.b.x - 120, x1: s.b.x });
  }
  const rowClash = (y, lo, hi, key) => rows.some((r) => r.net !== key && Math.abs(r.y - y) < MIN_GAP && r.x0 < hi && r.x1 > lo);
  const clash = (vertical, fixed, lo, hi, key) => (!vertical && rowClash(fixed, lo, hi, key)) || segs.some((s) => s.net !== key && (vertical
    ? Math.abs(s.x1 - s.x2) < 0.01 && Math.abs(s.x1 - fixed) < MIN_GAP && Math.min(s.y1, s.y2) < hi && Math.max(s.y1, s.y2) > lo
    : Math.abs(s.y1 - s.y2) < 0.01 && Math.abs(s.y1 - fixed) < MIN_GAP && Math.min(s.x1, s.x2) < hi && Math.max(s.x1, s.x2) > lo));
  // First free value near `pref` (alternating outward in 5px steps); `null` when
  // strict and nothing is free, otherwise the preferred value.
  const slide = (pref, min, max, test, strict = false) => {
    for (let k = 0; k < 80; k++) {
      for (const v of k === 0 ? [pref] : [pref + k * 5, pref - k * 5]) if (v >= min && v <= max && !test(v)) return v;
    }
    return strict ? null : pref;
  };
  const add = (net, x1, y1, x2, y2) => {
    if (Math.abs(x1 - x2) > 0.01 || Math.abs(y1 - y2) > 0.01) segs.push({ net, x1, y1, x2, y2 });
  };

  const ordered = [...nets.values()].sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x);
  for (const n of ordered) {
    const { key, a } = n;
    let fwd = n.sinks.filter((s) => s.b.x >= a.x + 56);
    const back = n.sinks.filter((s) => s.b.x < a.x + 56);
    if (fwd.length) {
      const ys = [a.y, ...fwd.map((s) => s.b.y)], lo = Math.min(...ys), hi = Math.max(...ys);
      const minB = Math.min(...fwd.map((s) => s.b.x));
      const pref = a.x + Math.min(90, Math.max(28, (minB - a.x) / 2));
      // the trunk must also keep its horizontal runs clear of other nets
      const tx = slide(pref, a.x + 18, minB - 18, (x) => clash(true, x, lo, hi, key)
        || clash(false, a.y, a.x, x, key) || fwd.some((s) => clash(false, s.b.y, x, s.b.x, key)), true);
      if (tx === null) { back.push(...fwd); fwd = []; } // no clean shared trunk: route each sink on its own
      else {
        add(key, a.x, a.y, tx, a.y);
        add(key, tx, lo, tx, hi);
        for (const s of fwd) add(key, tx, s.b.y, s.b.x, s.b.y);
      }
    }
    for (const s of back) { // wrap around: out -> down/up -> across -> in
      const { b } = s;
      const xs = slide(a.x + 28, a.x + 18, a.x + 500, (x) => clash(true, x, Math.min(a.y, b.y) - 50, Math.max(a.y, b.y) + 50, key));
      const xe = slide(b.x - 28, b.x - 500, b.x - 18, (x) => clash(true, x, Math.min(a.y, b.y) - 50, Math.max(a.y, b.y) + 50, key));
      const prefY = a.y === b.y ? a.y + 70 : (a.y + b.y) / 2;
      const ym = slide(prefY, Math.min(a.y, b.y) - 400, Math.max(a.y, b.y) + 400, (y) => clash(false, y, Math.min(xs, xe), Math.max(xs, xe), key));
      add(key, a.x, a.y, xs, a.y);
      add(key, xs, a.y, xs, ym);
      add(key, xs, ym, xe, ym);
      add(key, xe, ym, xe, b.y);
      add(key, xe, b.y, b.x, b.y);
    }
  }
  return { segs, ends };
}
