import type { ProposalDto, ProposalWord, TaggedWord, WordStatus } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Pencil, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, errorMessage, unwrap } from '@/lib/api';
import { meQuery, themeQuery, themesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SpeakButton } from '../SpeakButton';
import { STATUS_META, StatusToggle, TAGS } from '../status';
import { WordMeta } from '../WordMeta';
import { EditProposalDialog } from './EditProposalDialog';
import type { ThemeSetup } from './types';

type Item = ProposalWord & { status: WordStatus; included: boolean };

const KEY_TO_STATUS: Record<string, WordStatus> = {
  '1': 'unknown',
  '2': 'recognize',
  '3': 'known',
  '0': 'untagged',
};

function toTagged({ key: _k, existing: _e, inTheme: _t, included: _i, ...word }: Item): TaggedWord {
  return word;
}

export function ReviewStep({
  setup,
  proposal,
  onBack,
}: {
  setup: ThemeSetup;
  proposal: ProposalDto;
  onBack: (raw: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const lang = me?.profile.targetLang ?? 'pl';
  const [items, setItems] = useState<Item[]>(() =>
    proposal.words.map((w) => ({
      ...w,
      status: w.existing?.status ?? 'untagged',
      included: !w.inTheme,
    })),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const included = items.filter((i) => i.included);
  const counts = useMemo(() => {
    const c: Record<WordStatus, number> = { untagged: 0, unknown: 0, recognize: 0, known: 0 };
    for (const i of included) c[i.status]++;
    return c;
  }, [included]);
  const errors = proposal.issues.filter((i) => i.severity === 'error');
  const warnings = proposal.issues.filter((i) => i.severity === 'warning');

  const save = useMutation({
    mutationFn: async () => {
      const words = included.map(toTagged);
      if (setup.themeId) {
        await unwrap(
          api.themes[':id'].words.$post({
            param: { id: setup.themeId },
            json: { generationId: proposal.generationId, words },
          }),
        );
        return setup.themeId;
      }
      const theme = await unwrap(
        api.themes.$post({
          json: {
            name: setup.themeName,
            description: setup.description || undefined,
            generationId: proposal.generationId,
            words,
          },
        }),
      );
      return theme.id;
    },
    onSuccess: async (themeId) => {
      toast.success(`Saved ${included.length} words`);
      await queryClient.invalidateQueries(themesQuery);
      await queryClient.invalidateQueries(themeQuery(themeId));
      await navigate({ to: '/themes/$themeId', params: { themeId } });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const focusRow = (index: number) =>
    rowRefs.current[Math.max(0, Math.min(items.length - 1, index))]?.focus();

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, index: number, item: Item) => {
    // Only the row's main button handles shortcuts (not the tag buttons or inputs inside).
    if (e.target !== rowRefs.current[index]) return;
    const status = KEY_TO_STATUS[e.key];
    if (status) {
      e.preventDefault();
      update(item.key, { status, included: true });
      focusRow(index + 1);
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      focusRow(index + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      focusRow(index - 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'x') {
      e.preventDefault();
      update(item.key, { included: !item.included });
    } else if (e.key === 'e') {
      e.preventDefault();
      setEditing(item.key);
    }
  };

  const editingItem = items.find((i) => i.key === editing);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to generation"
          onClick={() => onBack(proposal.rawOutput)}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tag your words</h1>
          <p className="text-sm text-muted-foreground">{setup.themeName}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
        Mark each word as <strong className="text-status-unknown">don’t know</strong>,{' '}
        <strong className="text-status-recognize">recognize</strong> or{' '}
        <strong className="text-status-known">known</strong>. On a keyboard: focus a row and press{' '}
        <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> (moves to the next), <kbd>↑</kbd>/<kbd>↓</kbd> to
        move, <kbd>x</kbd> to leave a word out, <kbd>e</kbd> to edit.
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-status-recognize" />
            {errors.length > 0 && `${errors.length} skipped`}
            {errors.length > 0 && warnings.length > 0 && ' · '}
            {warnings.length > 0 && `${warnings.length} note${warnings.length === 1 ? '' : 's'}`}
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {proposal.issues.map((i, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity
              <li key={n} className={i.severity === 'error' ? 'text-incorrect' : undefined}>
                {i.row !== null && `Row ${i.row}${i.lemma ? ` (${i.lemma})` : ''}: `}
                {i.message}
              </li>
            ))}
          </ul>
          <Button
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => onBack(proposal.rawOutput)}
          >
            Edit the answer and read it again
          </Button>
        </details>
      )}

      {items.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <p className="font-medium">No usable words were found in the answer.</p>
          <p className="text-sm text-muted-foreground">
            The problems are listed above. Small on-device models often leave fields empty or copy
            the template; a larger model, an API key or the copy &amp; paste route usually works
            better.
          </p>
          {proposal.rawOutput.trim() ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                What the model answered
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {proposal.rawOutput}
              </pre>
            </details>
          ) : (
            <p className="text-sm text-muted-foreground">The model returned an empty answer.</p>
          )}
          <Button variant="outline" onClick={() => onBack(proposal.rawOutput)}>
            <ArrowLeft /> Back
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Mark all untagged as</span>
            {TAGS.map((t) => {
              const Icon = STATUS_META[t].icon;
              return (
                <Button
                  key={t}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setItems((list) =>
                      list.map((it) =>
                        it.included && it.status === 'untagged' ? { ...it, status: t } : it,
                      ),
                    )
                  }
                >
                  <Icon className={STATUS_META[t].text} /> {STATUS_META[t].label}
                </Button>
              );
            })}
          </div>

          <ul className="divide-y rounded-lg border bg-card" aria-label="Proposed words">
            {items.map((item, index) => (
              <li
                key={item.key}
                onKeyDown={(e) => onRowKey(e, index, item)}
                className={cn(
                  'flex flex-col gap-2 p-3 focus-within:bg-accent/40 sm:flex-row sm:items-center',
                  !item.included && 'opacity-50',
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={item.included}
                    onChange={(e) => update(item.key, { included: e.target.checked })}
                    aria-label={`Include ${item.lemma}`}
                    className="mt-1.5 size-4 accent-primary"
                    tabIndex={-1}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      {/* Focus target for keyboard tagging (1/2/3, arrows, x, e). */}
                      <button
                        type="button"
                        ref={(el) => {
                          rowRefs.current[index] = el;
                        }}
                        onClick={() => setEditing(item.key)}
                        aria-label={`${item.lemma}: ${item.translations.join(', ')}. ${STATUS_META[item.status].label}${item.included ? '' : ', left out'}. Press 1, 2 or 3 to tag, e to edit.`}
                        className="rounded-sm text-left text-lg font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                        lang={lang}
                      >
                        {item.lemma}
                      </button>
                      <SpeakButton text={item.lemma} lang={lang} />
                      <WordMeta
                        pos={item.pos}
                        gender={item.gender}
                        aspect={item.aspect}
                        aspectPair={item.aspectPair}
                      />
                    </div>
                    <p className="text-sm">{item.translations.join(', ')}</p>
                    {item.examples[0] && (
                      <p className="text-sm text-muted-foreground">
                        <span lang={lang}>{item.examples[0].text}</span>
                        {item.examples[0].translation && (
                          <span> · {item.examples[0].translation}</span>
                        )}
                      </p>
                    )}
                    {item.inTheme ? (
                      <Badge variant="outline" className="mt-1">
                        Already in this theme
                      </Badge>
                    ) : item.existing ? (
                      <Badge variant="outline" className="mt-1">
                        Already learning · {STATUS_META[item.existing.status].label}
                        {item.existing.themes.length > 0 &&
                          ` · ${item.existing.themes.map((t) => t.name).join(', ')}`}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 pl-7 sm:pl-0">
                  <StatusToggle
                    value={item.status}
                    onChange={(status) => update(item.key, { status, included: true })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${item.lemma}`}
                    tabIndex={-1}
                    onClick={() => setEditing(item.key)}
                  >
                    <Pencil />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <p className="flex-1 text-sm text-muted-foreground">
            {included.length} word{included.length === 1 ? '' : 's'}
            {counts.untagged > 0 && ` · ${counts.untagged} untagged`}
          </p>
          <Button onClick={() => save.mutate()} disabled={!included.length || save.isPending}>
            {save.isPending ? 'Saving…' : setup.themeId ? 'Add to theme' : 'Save theme'}
          </Button>
        </div>
      </div>

      {editingItem && (
        <EditProposalDialog
          word={editingItem}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            update(editingItem.key, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
