import type { LessonItemDto } from '@alivocab/shared';
import { Check, X } from 'lucide-react';
import { useEffect } from 'react';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { WordMeta } from '@/features/themes/WordMeta';
import { cn } from '@/lib/utils';

const PROMPTS: Record<string, string> = {
  choose_meaning: 'What does it mean?',
  choose_picture: 'Which picture is it?',
  choose_word: 'Which word is it?',
};

/** The question part of a multiple-choice exercise. */
function Question({ item }: { item: LessonItemDto }) {
  const { card } = item;
  if (item.kind === 'choose_word') {
    return (
      <div className="grid place-items-center gap-3 text-center">
        {card.image && (
          <img
            src={card.image.url}
            alt=""
            className="max-h-36 w-auto rounded-lg border object-cover sm:max-h-44"
          />
        )}
        <p className="text-3xl font-semibold break-words">{card.translations.join(', ')}</p>
        <WordMeta pos={card.pos} />
      </div>
    );
  }
  return (
    <div className="grid place-items-center gap-2 text-center">
      <div className="flex items-center gap-1">
        <p className="text-4xl font-semibold break-words" lang={card.lang}>
          {card.lemma}
        </p>
        <SpeakButton text={card.lemma} lang={card.lang} />
      </div>
      <WordMeta pos={card.pos} gender={card.gender} aspect={card.aspect} />
    </div>
  );
}

/**
 * Pick one of four options (words, meanings or pictures). Number keys 1–4 choose. After
 * answering, the right option is marked, and a wrong choice too, with icons as well as color.
 */
export function ChoiceExercise({
  item,
  chosen,
  onChoose,
}: {
  item: LessonItemDto;
  /** The option picked, once answered. */
  chosen: string | null;
  onChoose: (lexemeId: string) => void;
}) {
  const options = item.options ?? [];
  const pictures = item.kind === 'choose_picture';
  const answered = chosen !== null;

  useEffect(() => {
    if (answered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      const option = options[n - 1];
      if (option) {
        e.preventDefault();
        onChoose(option.lexemeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered, options, onChoose]);

  return (
    <div className="space-y-5">
      <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
        {PROMPTS[item.kind]}
      </p>
      <Question item={item} />
      <ul
        className={cn('grid gap-2', pictures ? 'grid-cols-2' : 'sm:grid-cols-2')}
        aria-label="Options"
      >
        {options.map((option, i) => {
          const right = option.lexemeId === item.card.lexemeId;
          const picked = option.lexemeId === chosen;
          return (
            <li key={option.lexemeId}>
              <button
                type="button"
                disabled={answered}
                onClick={() => onChoose(option.lexemeId)}
                aria-label={pictures ? `Picture ${i + 1}` : undefined}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-xl border bg-card text-left shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent',
                  pictures ? 'aspect-[4/3] overflow-hidden p-0' : 'min-h-14 px-4 py-3',
                  answered && right && 'border-correct ring-2 ring-correct/40',
                  answered && picked && !right && 'border-incorrect ring-2 ring-incorrect/40',
                  answered && !right && !picked && 'opacity-60',
                )}
              >
                {pictures ? (
                  option.image && (
                    <img src={option.image.url} alt="" className="size-full object-cover" />
                  )
                ) : (
                  <>
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                      {i + 1}
                    </span>
                    <span
                      className="flex-1 text-base font-medium"
                      lang={item.kind === 'choose_word' ? item.card.lang : undefined}
                    >
                      {option.text}
                    </span>
                  </>
                )}
                {answered && (right || picked) && (
                  <span
                    className={cn(
                      'grid size-6 place-items-center rounded-full',
                      pictures && 'absolute top-2 right-2 bg-card',
                      right ? 'text-correct' : 'text-incorrect',
                    )}
                  >
                    {right ? (
                      <Check className="size-4" aria-label="Right answer" />
                    ) : (
                      <X className="size-4" aria-label="Your answer" />
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
