// Local-date utilities. Entry keys are LOCAL ISO dates (YYYY-MM-DD).
// Never use Date.toISOString() for keys — it converts to UTC and files
// evening entries under the wrong day.

export function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO() {
  return toLocalISO(new Date());
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toLocalISO(d);
}

// Week-start convention is DATE-SCOPED, so each sprint era keeps its own
// weeks: MONDAY-start before 2026-10-25 (the Sprint 1 era — its archive
// stays exactly as it was lived), SUNDAY-start from 2026-10-25 on (Sprint
// 2+). The cutoff deliberately falls ON a Sunday, so no new-era week ever
// reaches back across it; the gap week Oct 19–24 is a 6-day seam, which is
// fine — it sits between sprints. One rule here, no per-sprint plumbing.
const SUNDAY_WEEKS_FROM = '2026-10-25';
export function startOfWeek(iso) {
  const d = fromISO(iso);
  const offset = iso >= SUNDAY_WEEKS_FROM ? d.getDay() : (d.getDay() + 6) % 7;
  return addDays(iso, -offset);
}

// Step between WEEK STARTS across the convention seam. Raw ±7 days from a
// week start lands mid-week when the step crosses 2026-10-25 (the seam week
// Oct 19–24 is only 6 days long), so every step re-normalizes. Use these —
// never addDays(ws, ±7) — when walking the week grid.
export function nextWeek(ws) {
  return startOfWeek(addDays(ws, 7));
}
export function prevWeek(ws) {
  return startOfWeek(addDays(ws, -1));   // the day before a week start is always in the previous week
}
// Inclusive last day of the week starting at ws (addDays(ws, 6) overshoots
// the 6-day seam week).
export function endOfWeek(ws) {
  return addDays(nextWeek(ws), -1);
}

export function addMonths(iso, n) {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toLocalISO(d);
}

// 7-column Sunday-start grid for the month containing `iso`.
// Cells outside the month are null.
export function monthGrid(iso) {
  const d = fromISO(iso);
  const y = d.getFullYear();
  const m = d.getMonth();
  const lead = new Date(y, m, 1).getDay();   // Sunday-first, like startOfWeek
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(toLocalISO(new Date(y, m, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function fmt(iso, options) {
  return fromISO(iso).toLocaleDateString(undefined, options);
}

export function weekdayName(iso) {
  return fmt(iso, { weekday: 'long' });
}

export function dayTitle(iso) {
  return fmt(iso, { month: 'long', day: 'numeric' });
}

export function monthTitle(iso) {
  return fmt(iso, { month: 'long', year: 'numeric' });
}

export function weekLabel(iso) {
  const start = startOfWeek(iso);
  const end = addDays(start, 6);
  const s = fmt(start, { month: 'short', day: 'numeric' });
  const e = fmt(end, start.slice(0, 7) === end.slice(0, 7) ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${s} – ${e}`;
}
