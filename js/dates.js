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

// Monday-start week
export function startOfWeek(iso) {
  const d = fromISO(iso);
  const offset = (d.getDay() + 6) % 7;
  return addDays(iso, -offset);
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

// 7-column Monday-start grid for the month containing `iso`.
// Cells outside the month are null.
export function monthGrid(iso) {
  const d = fromISO(iso);
  const y = d.getFullYear();
  const m = d.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
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
