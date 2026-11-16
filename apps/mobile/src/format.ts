/** Indian digit grouping (12,34,567) without relying on Intl support in the JS engine. */
export function inr(n: number): string {
  const neg = n < 0; const [i, f] = Math.abs(Math.round(n * 100) / 100).toFixed(2).split('.');
  const last3 = i.slice(-3); const rest = i.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}₹${grouped}${f === '00' ? '' : `.${f}`}`;
}
export function monthsLabel(m: number): string { const y = Math.floor(m / 12); const r = m % 12; return [y ? `${y}y` : '', r || !y ? `${r}m` : ''].filter(Boolean).join(' '); }
export function parseMoney(s: string): number | null { const c = s.replace(/[,\s₹]/g, ''); return /^\d+(\.\d{1,2})?$/.test(c) ? Number(c) : null; }
