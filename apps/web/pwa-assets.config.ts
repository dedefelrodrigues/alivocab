import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/** Brand red from public/favicon.svg, used as the full-bleed background for masked icons. */
const BRAND = '#c62f3a';

// Regenerate icons with: pnpm --filter @alivocab/web pwa:icons
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: BRAND } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: BRAND } },
  },
  images: ['public/favicon.svg'],
});
