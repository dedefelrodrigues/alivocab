#!/usr/bin/env node
/**
 * Enforces the appearance rule from CLAUDE.md: components use semantic color tokens only.
 * Fails on raw Tailwind palette classes (bg-red-500, text-white, …) and hex/rgb/hsl literals
 * in apps/web/src. Palette values belong in packages/shared/src/appearance/palettes.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['apps/web/src'];
const EXTENSIONS = /\.(tsx?|css)$/;
const IGNORE = /(\.generated\.|routeTree\.gen\.ts$)/;

const TW_COLORS =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITIES =
  'bg|text|border|border-[trblxy]|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|shadow|accent|caret|placeholder';
const RULES = [
  {
    name: 'raw Tailwind color',
    re: new RegExp(`\\b(?:${UTILITIES})-(?:(?:${TW_COLORS})-\\d{2,3}|white|black)\\b`, 'g'),
  },
  { name: 'hex color literal', re: /(?<![\w&])#[0-9a-fA-F]{3,8}\b(?![\w-])/g },
  { name: 'rgb/hsl color literal', re: /\b(?:rgba?|hsla?)\(/g },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.test(path) && !IGNORE.test(path)) yield path;
  }
}

const problems = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { name, re } of RULES) {
        for (const m of line.matchAll(re)) {
          problems.push(`${relative(ROOT, file)}:${i + 1}  ${name}: "${m[0]}"`);
        }
      }
    });
  }
}

if (problems.length) {
  console.error('Raw colors found. Use semantic tokens (bg-primary, text-status-known, …):\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('check-raw-colors: ok');
