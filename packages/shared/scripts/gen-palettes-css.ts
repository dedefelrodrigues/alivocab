/**
 * Writes the palette CSS consumed by the web app.
 * Usage: tsx scripts/gen-palettes-css.ts <output-file>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generatePalettesCss } from '../src/appearance/css.ts';

const out = process.argv[2];
if (!out) {
  console.error('Usage: gen-palettes-css <output-file>');
  process.exit(1);
}
const target = resolve(process.cwd(), out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, generatePalettesCss());
console.log(`palettes css → ${target}`);
