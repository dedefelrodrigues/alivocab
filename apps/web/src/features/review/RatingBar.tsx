import type { ReviewRatingName } from '@alivocab/shared';
import { cn } from '@/lib/utils';

const RATINGS: Array<{ id: ReviewRatingName; label: string; key: string; className: string }> = [
  { id: 'again', label: 'Again', key: '1', className: 'text-incorrect' },
  { id: 'hard', label: 'Hard', key: '2', className: 'text-status-recognize' },
  { id: 'good', label: 'Good', key: '3', className: 'text-correct' },
  { id: 'easy', label: 'Easy', key: '4', className: 'text-primary' },
];

export const RATING_KEYS: Record<string, ReviewRatingName> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

export function RatingBar({
  intervals,
  onRate,
  disabled,
}: {
  intervals: Record<ReviewRatingName, string>;
  onRate: (rating: ReviewRatingName) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="m-0 grid min-w-0 grid-cols-4 gap-2 border-0 p-0" disabled={disabled}>
      <legend className="sr-only">How well did you remember it?</legend>
      {RATINGS.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onRate(r.id)}
          className={cn(
            'grid gap-0.5 rounded-xl border bg-card px-2 py-3 text-center shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
          )}
        >
          <span className={cn('font-semibold', r.className)}>{r.label}</span>
          <span className="text-xs text-muted-foreground">
            {intervals[r.id]}
            <span className="hidden sm:inline"> · {r.key}</span>
          </span>
        </button>
      ))}
    </fieldset>
  );
}
