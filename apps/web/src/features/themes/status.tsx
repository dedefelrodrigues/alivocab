import { STATUS_LABELS, type StatusCounts, type WordStatus } from '@alivocab/shared';
import { CircleCheck, CircleDashed, CircleX, Eye, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Visuals per tag. Color is always paired with an icon and label (never color alone). */
export const STATUS_META: Record<
  WordStatus,
  { label: string; icon: LucideIcon; text: string; bg: string; key: string }
> = {
  unknown: {
    label: STATUS_LABELS.unknown,
    icon: CircleX,
    text: 'text-status-unknown',
    bg: 'bg-status-unknown',
    key: '1',
  },
  recognize: {
    label: STATUS_LABELS.recognize,
    icon: Eye,
    text: 'text-status-recognize',
    bg: 'bg-status-recognize',
    key: '2',
  },
  known: {
    label: STATUS_LABELS.known,
    icon: CircleCheck,
    text: 'text-status-known',
    bg: 'bg-status-known',
    key: '3',
  },
  untagged: {
    label: STATUS_LABELS.untagged,
    icon: CircleDashed,
    text: 'text-muted-foreground',
    bg: 'bg-muted-foreground/40',
    key: '0',
  },
};

export const TAGS = ['unknown', 'recognize', 'known'] as const satisfies readonly WordStatus[];

/** Three-way tag control (Don't know / Recognize / Known). Clicking the active tag clears it. */
export function StatusToggle({
  value,
  onChange,
  size = 'md',
  labelledBy,
}: {
  value: WordStatus;
  onChange: (status: WordStatus) => void;
  size?: 'sm' | 'md';
  labelledBy?: string;
}) {
  return (
    <fieldset
      aria-labelledby={labelledBy}
      className="m-0 inline-flex min-w-0 shrink-0 gap-1 border-0 p-0"
    >
      {TAGS.map((tag) => {
        const meta = STATUS_META[tag];
        const Icon = meta.icon;
        const active = value === tag;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            title={`${meta.label} (${meta.key})`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(active ? 'untagged' : tag);
            }}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md border text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              size === 'sm' ? 'h-8 px-2' : 'h-10 px-3',
              active
                ? cn('border-current bg-card', meta.text)
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className={cn('size-4', active && meta.text)} aria-hidden />
            <span className={cn(size === 'sm' ? 'sr-only' : 'hidden sm:inline')}>{meta.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

/** Stacked progress bar of tag counts with an accessible text summary. */
export function StatusBar({ counts, className }: { counts: StatusCounts; className?: string }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const order: WordStatus[] = ['known', 'recognize', 'unknown', 'untagged'];
  const summary = order
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${STATUS_META[s].label.toLowerCase()}`)
    .join(', ');
  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={total ? summary : 'No words yet'}
      >
        {total > 0 &&
          order.map((s) =>
            counts[s] ? (
              <span
                key={s}
                className={STATUS_META[s].bg}
                style={{ width: `${(counts[s] / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" aria-hidden>
        {order
          .filter((s) => counts[s])
          .map((s) => {
            const Icon = STATUS_META[s].icon;
            return (
              <li key={s} className="inline-flex items-center gap-1">
                <Icon className={cn('size-3', STATUS_META[s].text)} />
                {counts[s]} {STATUS_META[s].label.toLowerCase()}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
