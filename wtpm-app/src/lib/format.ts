export const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const hrs = (min: number | null | undefined, d = 1) => (min == null ? '—' : (min / 60).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const shortDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export function oeeTone(v: number | null | undefined, low = 0.6, high = 0.8): 'good' | 'warn' | 'bad' | 'none' {
  if (v == null) return 'none';
  return v < low ? 'bad' : v <= high ? 'warn' : 'good';
}
export const localToday = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
export function currentShift(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 390 && mins < 900) return 1;
  if (mins >= 900 && mins < 1410) return 2;
  return 3;
}
