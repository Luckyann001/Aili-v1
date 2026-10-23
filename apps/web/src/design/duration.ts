/** Parses a CSS time value ("600ms", ".6s", "0s") to milliseconds. Build minifiers may rewrite ms as s. */
export function cssDurationMs(value: string): number {
  const m = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/i.exec(value);
  if (!m) return 0;
  const n = parseFloat(m[1]!);
  return m[2]!.toLowerCase() === "s" ? n * 1000 : n;
}
