// Tiny dependency-free SVG charts, themed via CSS variables.
// Single-series only (no legends needed); values/labels use ink tokens,
// marks use the accent; reference lines are dashed with a direct label.

import { fromISO, fmt } from './dates.js';

const W = 320;
const H = 150;
const PAD = { top: 14, right: 10, bottom: 20, left: 34 };

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

const fmtN = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtCompact = (n) => (Math.abs(n) >= 10000 ? `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : fmtN(n));

function yScale(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const padY = (max - min) * 0.08;
  const lo = min - padY;
  const hi = max + padY;
  return { lo, hi, y: (v) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - (v - lo) / (hi - lo)) };
}

function frame(svg, sc, yLoLabel, yHiLabel) {
  for (const v of [0, 0.5, 1]) {
    const gy = PAD.top + (H - PAD.top - PAD.bottom) * v;
    svg.append(s('line', { x1: PAD.left, y1: gy, x2: W - PAD.right, y2: gy, class: 'ch-grid' }));
  }
  svg.append(s('text', { x: PAD.left - 5, y: sc.y(sc.hi) + 8, class: 'ch-lab ch-end' }, yHiLabel));
  svg.append(s('text', { x: PAD.left - 5, y: sc.y(sc.lo) + 3, class: 'ch-lab ch-end' }, yLoLabel));
}

// points: [{ iso, value }] sorted by date. goal: { value, label } | null
export function lineChart({ points, goal = null, unit = '', ariaLabel = 'trend chart' }) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel });
  if (points.length < 2) return svg;

  const xs = points.map((p) => fromISO(p.iso).getTime());
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const x = (t) => PAD.left + (W - PAD.left - PAD.right) * (xHi === xLo ? 0.5 : (t - xLo) / (xHi - xLo));
  const vals = points.map((p) => p.value);
  const sc = yScale(Math.min(...vals, goal ? goal.value : Infinity), Math.max(...vals, goal ? goal.value : -Infinity));

  frame(svg, sc, fmtCompact(sc.lo + (sc.hi - sc.lo) * 0.08), fmtCompact(sc.hi - (sc.hi - sc.lo) * 0.08));
  svg.append(s('text', { x: PAD.left, y: H - 5, class: 'ch-lab' }, fmt(points[0].iso, { month: 'short', day: 'numeric' })));
  svg.append(s('text', { x: W - PAD.right, y: H - 5, class: 'ch-lab ch-end' }, fmt(points[points.length - 1].iso, { month: 'short', day: 'numeric' })));

  if (goal) {
    const gy = sc.y(goal.value);
    svg.append(s('line', { x1: PAD.left, y1: gy, x2: W - PAD.right, y2: gy, class: 'ch-goal' }));
    svg.append(s('text', { x: W - PAD.right, y: gy - 4, class: 'ch-goal-lab ch-end' }, goal.label));
  }

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(fromISO(p.iso).getTime()).toFixed(1)},${sc.y(p.value).toFixed(1)}`).join(' ');
  svg.append(s('path', { d, class: 'ch-line' }));
  for (const p of points) {
    svg.append(s('circle', { cx: x(fromISO(p.iso).getTime()).toFixed(1), cy: sc.y(p.value).toFixed(1), r: 3, class: 'ch-dot' }));
  }
  // direct label on the latest value (ink, not series color)
  const lastP = points[points.length - 1];
  const lx = x(fromISO(lastP.iso).getTime());
  svg.append(s('text', {
    x: Math.min(lx, W - PAD.right - 4), y: sc.y(lastP.value) - 8,
    class: 'ch-val ch-end',
  }, `${fmtN(lastP.value)}${unit ? ' ' + unit : ''}`));

  attachHover(svg, points.map((p) => ({
    x: x(fromISO(p.iso).getTime()), y: sc.y(p.value),
    text: `${fmt(p.iso, { month: 'short', day: 'numeric' })} · ${fmtN(p.value)}${unit ? ' ' + unit : ''}`,
  })));
  return svg;
}

// bars: [{ label, value }] oldest first
export function barChart({ bars, unit = '', ariaLabel = 'bar chart' }) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel });
  if (bars.length === 0) return svg;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const sc = yScale(0, max);
  frame(svg, sc, '0', fmtCompact(max));

  const span = W - PAD.left - PAD.right;
  const gap = 2;
  const bw = Math.min(28, span / bars.length - gap);
  const targets = [];
  bars.forEach((b, i) => {
    const cx = PAD.left + span * (bars.length === 1 ? 0.5 : i / (bars.length - 1) * 0.9 + 0.05);
    const bx = cx - bw / 2;
    const by = sc.y(b.value);
    const base = sc.y(0);
    if (b.value > 0) {
      svg.append(s('rect', { x: bx.toFixed(1), y: by.toFixed(1), width: bw.toFixed(1), height: Math.max(2, base - by).toFixed(1), rx: 3, class: 'ch-bar' }));
    } else {
      svg.append(s('rect', { x: bx.toFixed(1), y: base - 2, width: bw.toFixed(1), height: 2, rx: 1, class: 'ch-bar ch-bar-zero' }));
    }
    targets.push({ x: cx, y: by, text: `${b.label} · ${fmtCompact(b.value)}${unit ? ' ' + unit : ''}` });
  });
  svg.append(s('text', { x: PAD.left, y: H - 5, class: 'ch-lab' }, bars[0].label));
  svg.append(s('text', { x: W - PAD.right, y: H - 5, class: 'ch-lab ch-end' }, bars[bars.length - 1].label));
  const lastB = bars[bars.length - 1];
  if (lastB.value > 0) {
    const t = targets[targets.length - 1];
    svg.append(s('text', { x: Math.min(t.x, W - PAD.right - 4), y: t.y - 6, class: 'ch-val ch-end' }, fmtCompact(lastB.value)));
  }
  attachHover(svg, targets);
  return svg;
}

// nearest-point tap/hover tooltip, one per chart
function attachHover(svg, targets) {
  const tipLine = s('line', { class: 'ch-cross', y1: PAD.top, y2: H - PAD.bottom, visibility: 'hidden' });
  const tipBg = s('rect', { class: 'ch-tip-bg', rx: 5, height: 16, visibility: 'hidden' });
  const tipText = s('text', { class: 'ch-tip', visibility: 'hidden' });
  const ring = s('circle', { r: 5, class: 'ch-ring', visibility: 'hidden' });
  svg.append(tipLine, tipBg, tipText, ring);

  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left) / rect.width * W;
    let best = targets[0];
    for (const t of targets) if (Math.abs(t.x - px) < Math.abs(best.x - px)) best = t;
    tipLine.setAttribute('x1', best.x); tipLine.setAttribute('x2', best.x);
    ring.setAttribute('cx', best.x); ring.setAttribute('cy', best.y);
    tipText.textContent = best.text;
    const tw = best.text.length * 5.4 + 12;
    const tx = Math.max(PAD.left, Math.min(best.x - tw / 2, W - PAD.right - tw));
    tipBg.setAttribute('x', tx); tipBg.setAttribute('y', 1); tipBg.setAttribute('width', tw);
    tipText.setAttribute('x', tx + tw / 2); tipText.setAttribute('y', 12);
    for (const eln of [tipLine, tipBg, tipText, ring]) eln.setAttribute('visibility', 'visible');
  };
  const hide = () => { for (const eln of [tipLine, tipBg, tipText, ring]) eln.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}
