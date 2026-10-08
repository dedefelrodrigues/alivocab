import { CEFR_LEVELS, type CefrLevel } from '@alivocab/shared';
import { FormField } from '@/components/form-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ThemeSetup } from './types';

const ANY_LEVEL = 'any';

export function validateSetup(s: ThemeSetup): Partial<Record<keyof ThemeSetup, string>> {
  const errors: Partial<Record<keyof ThemeSetup, string>> = {};
  if (!s.themeName.trim()) errors.themeName = 'Give the theme a name, e.g. “At the bakery”';
  if (!Number.isInteger(s.count) || s.count < 5 || s.count > 100)
    errors.count = 'Between 5 and 100';
  return errors;
}

export function SetupCard({
  value,
  onChange,
  errors,
  locked,
}: {
  value: ThemeSetup;
  onChange: (v: ThemeSetup) => void;
  errors: Partial<Record<keyof ThemeSetup, string>>;
  locked: boolean;
}) {
  const set = <K extends keyof ThemeSetup>(k: K, v: ThemeSetup[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Theme</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormField id="themeName" label="Theme" error={errors.themeName}>
          <Input
            id="themeName"
            value={value.themeName}
            disabled={locked}
            placeholder="At the bakery, Job interview, Football…"
            maxLength={80}
            aria-invalid={!!errors.themeName}
            onChange={(e) => set('themeName', e.target.value)}
            autoFocus={!locked}
          />
        </FormField>
        <FormField
          id="description"
          label="Details (optional)"
          hint="Anything that helps the AI: situations, register, words you want included."
        >
          <Input
            id="description"
            value={value.description}
            disabled={locked}
            maxLength={500}
            placeholder="Buying bread and pastries, asking about ingredients"
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField id="count" label="Number of words" error={errors.count}>
            <Input
              id="count"
              type="number"
              inputMode="numeric"
              min={5}
              max={100}
              value={String(value.count)}
              aria-invalid={!!errors.count}
              onChange={(e) => set('count', Number(e.target.value))}
            />
          </FormField>
          <FormField id="level" label="Level">
            <Select
              value={value.level ?? ANY_LEVEL}
              onValueChange={(v) => set('level', v === ANY_LEVEL ? null : (v as CefrLevel))}
            >
              <SelectTrigger id="level" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_LEVEL}>Mixed</SelectItem>
                {CEFR_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </CardContent>
    </Card>
  );
}
