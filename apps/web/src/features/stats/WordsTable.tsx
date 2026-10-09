import type { WordStatsDto } from '@alivocab/shared';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WordThumb } from '@/features/pictures/WordThumb';
import { STATUS_META } from '@/features/themes/status';
import { cn } from '@/lib/utils';

type SortKey = 'word' | 'status' | 'exposures' | 'reviews' | 'accuracy' | 'lapses' | 'next';

const STATUS_ORDER = { untagged: 0, unknown: 1, recognize: 2, known: 3 } as const;

const accuracy = (w: WordStatsDto) => {
  const total = w.correct + w.incorrect;
  return total ? w.correct / total : null;
};

const VALUE: Record<SortKey, (w: WordStatsDto) => number | string> = {
  word: (w) => w.lemma.toLocaleLowerCase(w.lang),
  status: (w) => STATUS_ORDER[w.status],
  exposures: (w) => w.exposures,
  reviews: (w) => w.reviews,
  // Words never answered sort as if perfect, so the ones actually missed come first.
  accuracy: (w) => accuracy(w) ?? 2,
  lapses: (w) => w.lapses,
  next: (w) => (w.nextDue ? Date.parse(w.nextDue) : Number.MAX_SAFE_INTEGER),
};

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean; wide?: boolean }> = [
  { key: 'word', label: 'Word' },
  { key: 'status', label: 'Status' },
  { key: 'exposures', label: 'Seen', numeric: true, wide: true },
  { key: 'reviews', label: 'Reviews', numeric: true, wide: true },
  { key: 'accuracy', label: 'Right', numeric: true },
  { key: 'lapses', label: 'Forgot', numeric: true, wide: true },
  { key: 'next', label: 'Next review', wide: true },
];

function relativeDue(iso: string | null): string {
  if (!iso) return 'Not started';
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days <= 0) return 'Due now';
  if (days === 1) return 'Tomorrow';
  if (days < 30) return `In ${days} days`;
  return `In ${Math.round(days / 30)} mo`;
}

const PAGE = 100;

/** Every word with how often it was seen, reviewed and missed. Sortable and searchable. */
export function WordsTable({ words }: { words: WordStatsDto[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'accuracy',
    desc: false,
  });
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase();
    const list = q
      ? words.filter(
          (w) =>
            w.lemma.toLocaleLowerCase().includes(q) ||
            w.translations.some((t) => t.toLocaleLowerCase().includes(q)),
        )
      : words;
    const value = VALUE[sort.key];
    return [...list].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
      return (sort.desc ? -cmp : cmp) || a.lemma.localeCompare(b.lemma);
    });
  }, [words, filter, sort]);

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, desc: !s.desc }
        : { key, desc: key !== 'word' && key !== 'accuracy' && key !== 'next' },
    );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search words"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search words or translations"
          className="pl-9"
        />
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 font-medium',
                    c.numeric && 'text-right',
                    c.wide && 'hidden sm:table-cell',
                  )}
                  aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      sort.key === c.key && 'text-foreground',
                    )}
                  >
                    {c.label}
                    {sort.key === c.key &&
                      (sort.desc ? (
                        <ArrowDown className="size-3" aria-hidden />
                      ) : (
                        <ArrowUp className="size-3" aria-hidden />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, limit).map((w) => {
              const meta = STATUS_META[w.status];
              const Icon = meta.icon;
              const acc = accuracy(w);
              return (
                <tr key={w.lexemeId}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <WordThumb lemma={w.lemma} image={w.image} className="size-8" />
                      <div className="min-w-0">
                        <p className="truncate font-medium" lang={w.lang}>
                          {w.lemma}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {w.translations.join(', ')}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn('inline-flex items-center gap-1 whitespace-nowrap', meta.text)}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="text-xs">{meta.label}</span>
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                    {w.exposures}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                    {w.reviews}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {acc === null ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      `${Math.round(acc * 100)}%`
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                    {w.lapses}
                  </td>
                  <td className="hidden px-3 py-2 whitespace-nowrap text-muted-foreground sm:table-cell">
                    {relativeDue(w.nextDue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No words match.</p>
        )}
      </div>
      {rows.length > limit && (
        <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({rows.length - limit} left)
        </Button>
      )}
    </div>
  );
}
