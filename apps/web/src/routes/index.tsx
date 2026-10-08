import { COLOR_MODES, type ColorMode, PALETTES } from '@alivocab/shared/appearance';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleCheck, CircleHelp, CircleX, Eye, Monitor, Moon, Sun } from 'lucide-react';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">Witaj! 👋</h1>
        <p className="text-muted-foreground">
          AliVocab is being built. This page checks the API connection and the appearance system.
        </p>
      </section>
      <ApiStatusCard />
      <AppearancePreviewCard />
    </div>
  );
}

function ApiStatusCard() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await api.health.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>API</CardTitle>
        <CardDescription>GET /api/health via the typed Hono client</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2 text-sm">
        {health.isPending && <span className="text-muted-foreground">Checking…</span>}
        {health.isError && (
          <span className="flex items-center gap-1.5 text-incorrect">
            <CircleX className="size-4" /> Unreachable: {health.error.message}
          </span>
        )}
        {health.isSuccess && (
          <span className="flex items-center gap-1.5 text-correct">
            <CircleCheck className="size-4" /> {health.data.service} is {health.data.status}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

const MODE_ICONS: Record<ColorMode, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

function AppearancePreviewCard() {
  const { mode, setMode, paletteSetting, setPaletteSetting, palette } = useAppearance();
  const options = [{ id: 'auto', label: 'Auto (learning language)' }, ...PALETTES];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance preview</CardTitle>
        <CardDescription>
          Temporary preview. The full settings page comes in Phase 1. Active palette:{' '}
          <span className="font-medium text-foreground">{palette}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color mode">
          {COLOR_MODES.map((m) => {
            const Icon = MODE_ICONS[m];
            return (
              <Button
                key={m}
                role="radio"
                aria-checked={mode === m}
                variant={mode === m ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode(m)}
              >
                <Icon /> {m[0]?.toUpperCase()}
                {m.slice(1)}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Palette">
          {options.map((p) => (
            <Button
              key={p.id}
              role="radio"
              aria-checked={paletteSetting === p.id}
              variant={paletteSetting === p.id ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(paletteSetting === p.id && 'ring-2 ring-ring')}
              onClick={() => setPaletteSetting(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-status-unknown">
            <CircleX /> Don't know
          </Badge>
          <Badge variant="outline" className="text-status-recognize">
            <Eye /> Recognize
          </Badge>
          <Badge variant="outline" className="text-status-known">
            <CircleCheck /> Known
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            <CircleHelp /> Untagged
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-flashcard-front p-6 text-center shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">noun · m</p>
            <p className="mt-1 text-3xl font-semibold">chleb</p>
          </div>
          <div className="rounded-xl border bg-flashcard-back p-6 text-center shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">translation</p>
            <p className="mt-1 text-3xl font-semibold">bread</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </CardContent>
    </Card>
  );
}
