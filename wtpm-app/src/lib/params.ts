import { monthRange } from './reports';
export function readFilter(url: string) {
  const u = new URL(url);
  const today = new Date().toISOString().slice(0, 10);
  const month = u.searchParams.get('month') || today.slice(0, 7);
  const mr = monthRange(month);
  const from = u.searchParams.get('from') || mr.from;
  const to = u.searchParams.get('to') || mr.to;
  const machineIds = (u.searchParams.get('machineIds') || '').split(',').map(Number).filter(Boolean);
  const shiftId = Number(u.searchParams.get('shift')) || null;
  const line = u.searchParams.get('line') || null;
  return { month, from, to, machineIds, shiftId, line, u };
}
