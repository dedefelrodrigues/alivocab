/**
 * Minimal OKLCH helpers used for contrast checks (tests, palette previews).
 * Conversion follows Björn Ottosson's OKLab reference matrices.
 */

export type Oklch = { l: number; c: number; h: number };

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

export function parseOklch(value: string): Oklch {
  const m = OKLCH_RE.exec(value.trim());
  if (!m) throw new Error(`Not an oklch(L C H) color: ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

function toOklab({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

/** Linear-light sRGB, clamped to gamut. */
function toLinearSrgb(color: Oklch): [number, number, number] {
  const [L, a, b] = toOklab(color);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(value: string): number {
  const [r, g, b] = toLinearSrgb(parseOklch(value));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Euclidean distance in OKLab (ΔEok). ~0.02 is a just-noticeable difference. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toOklab(parseOklch(a));
  const [l2, a2, b2] = toOklab(parseOklch(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
