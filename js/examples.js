// Starter circuits. Each builder receives an empty Circuit.
const wire = (c, a, ap, b, bp) => c.connect({ c: a.id, p: ap }, { c: b.id, p: bp });

export const EXAMPLES = {
  'Half adder'(c) {
    const a = c.add('switch', 60, 60), b = c.add('switch', 60, 180);
    const x = c.add('xor', 240, 60), n = c.add('and', 240, 180);
    const s = c.add('bulb', 400, 60), cy = c.add('bulb', 400, 180);
    wire(c, a, 0, x, 0); wire(c, b, 0, x, 1); wire(c, a, 0, n, 0); wire(c, b, 0, n, 1);
    wire(c, x, 0, s, 0); wire(c, n, 0, cy, 0);
  },
  'SR latch (memory)'(c) {
    const s = c.add('button', 40, 40), r = c.add('button', 40, 220);
    const n1 = c.add('nor', 240, 220), n2 = c.add('nor', 240, 60);
    const q = c.add('bulb', 420, 220), nq = c.add('bulb', 420, 60);
    wire(c, r, 0, n1, 0); wire(c, s, 0, n2, 1);
    wire(c, n1, 0, n2, 0); wire(c, n2, 0, n1, 1);
    wire(c, n1, 0, q, 0); wire(c, n2, 0, nq, 0);
  },
  '4-bit adder'(c) {
    // Two 4-bit number pads (0-15) -> ripple-carry adder -> 5-bit decimal display (0-30).
    const A = c.add('numpad', 40, 0), B = c.add('numpad', 40, 190);
    const D = c.add('display', 760, 200);
    c.configure(D, { bits: 5, base: 'dec' });
    const gate = (t, x, y, a, ap, b, bp) => {
      const g = c.add(t, x, y);
      wire(c, a, ap, g, 0); wire(c, b, bp, g, 1);
      return g;
    };
    // Bit 0 (half adder): pad pin 3 is the least significant bit.
    const s0 = gate('xor', 260, 0, A, 3, B, 3);
    let carry = gate('and', 260, 70, A, 3, B, 3);
    const sums = [s0];
    // Bits 1-3 (full adders): sum = a^b^cin, cout = a&b | (a^b)&cin
    for (let bit = 1; bit < 4; bit++) {
      const y = 150 + (bit - 1) * 180, pin = 3 - bit;
      const x = gate('xor', 260, y, A, pin, B, pin), g = gate('and', 260, y + 70, A, pin, B, pin);
      sums.push(gate('xor', 420, y, x, 0, carry, 0));
      const p = gate('and', 420, y + 70, x, 0, carry, 0);
      carry = gate('or', 570, y + 70, g, 0, p, 0);
    }
    wire(c, carry, 0, D, 0);                       // 16s
    sums.forEach((s, bit) => wire(c, s, 0, D, 4 - bit)); // 8s..1s
  },
  'Counter (clocks)'(c) {
    // Six clocks, each half the speed of the one below: read together their
    // on/off states are a 6-bit binary count, 0 to 63 (top clock = 32s bit).
    // 8 Hz on the bottom clock = 16 counts per second, wrapping every 4 s.
    const bits = 6;
    const D = c.add('display', 320, 150);
    c.configure(D, { bits, base: 'dec' });
    for (let i = 0; i < bits; i++) {
      const k = c.add('clock', 60, i * 70);
      c.configure(k, { hz: 8 / 2 ** (bits - 1 - i) });
      wire(c, k, 0, D, i);
    }
  },
  'Number pad → display'(c) {
    const p = c.add('numpad', 40, 40), d = c.add('display', 260, 55);
    [0, 1, 2, 3].forEach((i) => wire(c, p, i, d, i));
  },
  'Blinker'(c) {
    const k = c.add('clock', 40, 60), n = c.add('not', 180, 50), b = c.add('bulb', 320, 50);
    wire(c, k, 0, n, 0); wire(c, n, 0, b, 0);
  },
};
