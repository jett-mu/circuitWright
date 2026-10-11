// Strip-chart oscilloscope for probes, voltmeters and ammeters.
import { fmt } from './model.js';
import { CHANNEL_COLORS } from './render.js';

const CAP = 8000;

function niceStep(raw) {
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}
export const niceTime = niceStep;

export class Scope {
  constructor(canvas) {
    this.cv = canvas;
    this.channels = [];     // {id, label, kind:'v'|'i', get(sim), color}
    this.ts = [];
    this.data = [];         // per channel arrays
    this.perDiv = 1e-3;
    this.vdiv = 0;          // 0 = auto
    this.hold = false;
    this.last = -Infinity;
  }

  // chans: [{id, label, kind, net|get}]
  setChannels(chans) {
    const same = chans.length === this.channels.length && chans.every((c, i) => c.id === this.channels[i].id && c.kind === this.channels[i].kind);
    this.channels = chans.map((c, i) => ({ ...c, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }));
    if (!same) this.clear();
  }

  clear() { this.ts = []; this.data = this.channels.map(() => []); this.last = -Infinity; }

  span() { return this.perDiv * 10; }

  sample(sim) {
    if (this.hold || !this.channels.length) return;
    const minGap = this.span() / 1600;
    if (sim.t - this.last < minGap && this.ts.length) return;
    this.last = sim.t;
    this.ts.push(sim.t);
    this.channels.forEach((c, i) => this.data[i].push(c.get(sim)));
    if (this.ts.length > CAP) { this.ts.splice(0, CAP / 4); this.data.forEach((d) => d.splice(0, CAP / 4)); }
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const ink = css.getPropertyValue('--ink').trim() || '#1E2124', line = css.getPropertyValue('--line-2').trim() || '#BDB8AB';
    const dim = css.getPropertyValue('--ink-3').trim() || '#7C7F80', bg = css.getPropertyValue('--surface').trim() || '#FAF9F5';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace";
    if (!this.channels.length) {
      ctx.fillStyle = dim; ctx.textAlign = 'center';
      ctx.fillText('Add scope probes, voltmeters or ammeters to the diagram to see waveforms here.', W / 2, H / 2);
      return;
    }
    const kinds = ['v', 'i'].filter((k) => this.channels.some((c) => c.kind === k));
    const left = 58, right = 10, top = 8, bottom = 18;
    const ph = (H - top - bottom - (kinds.length - 1) * 10) / kinds.length;
    const t1 = this.ts.length ? this.ts[this.ts.length - 1] : 0;
    const span = this.span();
    const t0 = Math.max(0, t1 - span);
    const x = (t) => left + ((t - t0) / span) * (W - left - right);

    kinds.forEach((kind, k) => {
      const y0 = top + k * (ph + 10);
      const idx = this.channels.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
      // vertical scale
      let amp = 0;
      for (const i of idx) { const d = this.data[i]; for (let n = 0; n < d.length; n++) if (this.ts[n] >= t0) amp = Math.max(amp, Math.abs(d[n])); }
      const unit = kind === 'v' ? 'V' : 'A';
      let div = kind === 'v' && this.vdiv > 0 ? this.vdiv : niceStep(Math.max(amp, kind === 'v' ? 0.05 : 1e-6) * 1.15 / 4);
      const half = div * 4;
      const yv = (v) => y0 + ph / 2 - (v / half) * (ph / 2);
      // grid
      ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let g = 0; g <= 10; g++) { const gx = left + g * (W - left - right) / 10; ctx.moveTo(gx, y0); ctx.lineTo(gx, y0 + ph); }
      for (let g = -4; g <= 4; g++) { const gy = yv(g * div); ctx.moveTo(left, gy); ctx.lineTo(W - right, gy); }
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(left, yv(0)); ctx.lineTo(W - right, yv(0)); ctx.stroke();
      ctx.strokeRect(left, y0, W - left - right, ph);
      ctx.fillStyle = dim; ctx.textAlign = 'right';
      for (let g = -4; g <= 4; g += 2) ctx.fillText(fmt(g * div, ''), left - 6, yv(g * div) + 3);
      ctx.textAlign = 'left'; ctx.fillText(fmt(div, unit) + '/div', 4, y0 + 10);
      // traces
      for (const i of idx) {
        const d = this.data[i];
        ctx.strokeStyle = this.channels[i].color; ctx.lineWidth = 1.8;
        ctx.beginPath();
        let started = false;
        for (let n = 0; n < d.length; n++) {
          if (this.ts[n] < t0 - span * 0.02) continue;
          const px = x(this.ts[n]), py = Math.max(y0, Math.min(y0 + ph, yv(d[n])));
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
    // legend
    let lx = left + 6;
    const ly = H - 5;
    ctx.textAlign = 'left';
    this.channels.forEach((c, i) => {
      const d = this.data[i], last = d.length ? d[d.length - 1] : 0;
      const s = `${c.label} ${fmt(last, c.kind === 'v' ? 'V' : 'A')}`;
      ctx.fillStyle = c.color; ctx.fillRect(lx, ly - 8, 8, 8);
      ctx.fillStyle = ink; ctx.fillText(s, lx + 12, ly);
      lx += ctx.measureText(s).width + 30;
    });
    ctx.fillStyle = dim; ctx.textAlign = 'right';
    ctx.fillText(`${fmt(this.perDiv, 's')}/div`, W - right, H - 5);
  }
}
