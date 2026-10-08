import { languageName } from '@alivocab/shared';
import {
  COLOR_MODES,
  type ColorMode,
  PALETTES,
  type Palette,
  resolvePalette,
} from '@alivocab/shared/appearance';
import { Check, CircleCheck, CircleX, Eye, Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { useUpdateProfile } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';
import { SettingsCard } from './SettingsCard';

const MODE_META: Record<ColorMode, { label: string; icon: typeof Sun }> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};

export function AppearanceSection() {
  const { mode, paletteSetting, targetLang, resolvedMode } = useAppearance();
  const update = useUpdateProfile();
  const autoPalette = PALETTES.find((p) => p.id === resolvePalette('auto', targetLang));

  return (
    <SettingsCard
      id="appearance"
      title="Appearance"
      description="Saved to your account, so it follows you to every device."
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Mode</legend>
        <div className="inline-flex rounded-lg border p-1">
          {COLOR_MODES.map((m) => {
            const { label, icon: Icon } = MODE_META[m];
            return (
              <label
                key={m}
                className={cn(
                  'relative inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  'has-[:checked]:bg-primary has-[:checked]:text-primary-foreground',
                  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                )}
              >
                <input
                  type="radio"
                  name="colorMode"
                  value={m}
                  checked={mode === m}
                  onChange={() => update.mutate({ colorMode: m })}
                  aria-label={label}
                  className="sr-only"
                />
                <Icon className="size-4" aria-hidden /> {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Color palette</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {autoPalette && (
            <PaletteOption
              value="auto"
              palette={autoPalette}
              mode={resolvedMode}
              checked={paletteSetting === 'auto'}
              onSelect={() => update.mutate({ colorPalette: 'auto' })}
              ariaLabel={`Auto: follow ${languageName(targetLang)} (${autoPalette.label})`}
              title={
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="size-3.5" aria-hidden /> Auto
                </span>
              }
              subtitle={`Follows ${languageName(targetLang)}: ${autoPalette.label}`}
            />
          )}
          {PALETTES.map((p) => (
            <PaletteOption
              key={p.id}
              value={p.id}
              palette={p}
              mode={resolvedMode}
              checked={paletteSetting === p.id}
              onSelect={() => update.mutate({ colorPalette: p.id })}
              ariaLabel={`${p.label}: ${p.description}`}
              title={p.label}
              subtitle={p.description}
            />
          ))}
        </div>
      </fieldset>
    </SettingsCard>
  );
}

/** A radio option with a live mini-preview rendered in the palette's own tokens. */
function PaletteOption({
  value,
  palette,
  mode,
  checked,
  onSelect,
  ariaLabel,
  title,
  subtitle,
}: {
  value: string;
  ariaLabel: string;
  palette: Palette;
  mode: 'light' | 'dark';
  checked: boolean;
  onSelect: () => void;
  title: ReactNode;
  subtitle: string;
}) {
  return (
    <label
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-xl border transition-shadow',
        'hover:shadow-md has-[:checked]:ring-2 has-[:checked]:ring-primary',
        'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
      )}
    >
      <input
        type="radio"
        name="colorPalette"
        value={value}
        checked={checked}
        onChange={onSelect}
        aria-label={ariaLabel}
        className="sr-only"
      />
      <div
        aria-hidden
        data-palette={palette.id}
        className={cn('space-y-2 bg-background p-3 text-foreground', mode === 'dark' && 'dark')}
      >
        <div className="flex items-center gap-1.5">
          <span className="h-5 flex-1 rounded-md bg-primary" />
          <span className="h-5 w-6 rounded-md bg-accent" />
          <span className="h-5 w-6 rounded-md bg-secondary" />
        </div>
        <div className="flex gap-1">
          <CircleX className="size-3.5 text-status-unknown" />
          <Eye className="size-3.5 text-status-recognize" />
          <CircleCheck className="size-3.5 text-status-known" />
        </div>
        <div className="rounded-md border bg-flashcard-front px-2 py-1 text-center text-xs font-semibold">
          słowo
        </div>
      </div>
      <div className="border-t bg-card px-3 py-2">
        <span className="flex items-center justify-between text-sm font-medium">
          {title}
          {checked && <Check className="size-4 text-primary" aria-hidden />}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{subtitle}</span>
      </div>
    </label>
  );
}
