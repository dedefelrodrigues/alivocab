import type { MaterialKind } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookText, Headphones, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { materialsQuery } from '@/lib/queries';
import { MaterialDialog } from './MaterialDialog';

const ICON = { listening: Headphones, grammar: BookText } as const;
const KIND_LABEL = { listening: 'Listening', grammar: 'Grammar' } as const;

/** Listening scripts and grammar notes for a theme, with buttons to create new ones. */
export function MaterialsCard({ themeId, disabled }: { themeId: string; disabled?: boolean }) {
  const { data: materials } = useQuery(materialsQuery(themeId));
  const [creating, setCreating] = useState<MaterialKind | null>(null);

  return (
    <section aria-labelledby="materials-heading" className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="materials-heading" className="flex-1 font-semibold">
          Listening &amp; grammar
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setCreating('listening')}
        >
          <Plus /> Listening
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setCreating('grammar')}
        >
          <Plus /> Grammar note
        </Button>
      </div>
      {materials && materials.length > 0 ? (
        <ul className="divide-y">
          {materials.map((m) => {
            const Icon = ICON[m.kind];
            return (
              <li key={m.id}>
                <Link
                  to="/materials/$materialId"
                  params={{ materialId: m.id }}
                  className="flex items-center gap-3 rounded-md py-2 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {KIND_LABEL[m.kind]} · {m.wordCount} theme word{m.wordCount === 1 ? '' : 's'}{' '}
                      · {new Date(m.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Let AI write a dialogue or story with your words to listen to, or a short grammar lesson
          built around them.
        </p>
      )}
      {creating && (
        <MaterialDialog themeId={themeId} kind={creating} onClose={() => setCreating(null)} />
      )}
    </section>
  );
}
