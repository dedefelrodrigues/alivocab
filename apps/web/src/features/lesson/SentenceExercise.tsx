import type { LessonItemDto } from '@alivocab/shared';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const chip =
  'rounded-lg border bg-card px-3 py-2 text-base shadow-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent';

/**
 * Put the shuffled words of a sentence in order: tap words in the bank to add them, tap an added
 * word to put it back.
 */
export function SentenceExercise({
  item,
  answered,
  onSubmit,
}: {
  item: LessonItemDto;
  answered: boolean;
  onSubmit: (words: string[]) => void;
}) {
  const sentence = item.sentence;
  // Picked positions in `tokens` (positions, so repeated words stay distinct).
  const [picked, setPicked] = useState<number[]>([]);
  if (!sentence) return null;
  const { tokens } = sentence;
  const complete = picked.length === tokens.length;

  return (
    <div className="space-y-5">
      <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
        Put the words in order
      </p>
      {sentence.translation && (
        <p className="text-center text-xl font-medium">{sentence.translation}</p>
      )}
      <fieldset
        className="m-0 flex min-h-14 flex-wrap items-center gap-2 rounded-xl border border-dashed p-2"
        lang={item.card.lang}
      >
        <legend className="sr-only">Your sentence</legend>
        {picked.length === 0 && (
          <span className="px-2 text-sm text-muted-foreground">Tap the words below</span>
        )}
        {picked.map((pos, i) => (
          <button
            key={pos}
            type="button"
            disabled={answered}
            className={cn(chip, 'border-primary/40')}
            onClick={() => setPicked((p) => p.filter((x) => x !== pos))}
            aria-label={`Remove “${tokens[pos]}”`}
          >
            {tokens[pos]}
            {i === picked.length - 1 && complete ? sentence.end : ''}
          </button>
        ))}
      </fieldset>
      <fieldset
        className="m-0 flex flex-wrap justify-center gap-2 border-0 p-0"
        lang={item.card.lang}
      >
        <legend className="sr-only">Words to place</legend>
        {tokens.map((token, pos) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: positions identify repeated words
            key={pos}
            type="button"
            disabled={answered || picked.includes(pos)}
            className={cn(chip, picked.includes(pos) && 'opacity-30')}
            onClick={() => setPicked((p) => [...p, pos])}
          >
            {token}
          </button>
        ))}
      </fieldset>
      {!answered && (
        <div className="flex gap-2">
          <Button
            className="h-11 flex-1 text-base"
            disabled={!complete}
            onClick={() => onSubmit(picked.map((pos) => tokens[pos] ?? ''))}
          >
            Check
          </Button>
          <Button variant="outline" disabled={!picked.length} onClick={() => setPicked([])}>
            <RotateCcw /> Reset
          </Button>
        </div>
      )}
    </div>
  );
}
