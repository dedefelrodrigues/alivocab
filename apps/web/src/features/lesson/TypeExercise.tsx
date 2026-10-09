import { SPECIAL_LETTERS } from '@alivocab/core';
import { type LessonItemDto, languageName } from '@alivocab/shared';
import { Eye, Lightbulb } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { WordMeta } from '@/features/themes/WordMeta';

/** What the learner should type for a typing exercise. */
export function expectedAnswer(item: LessonItemDto): string {
  if (item.kind === 'drill' && item.drill) return item.drill.answer;
  if (item.kind === 'cloze' && item.cloze) return item.cloze.answer;
  return item.card.lemma;
}

/** The question part: a meaning (and picture) to name, a sentence gap, or a form to produce. */
function Question({ item, showMeaning }: { item: LessonItemDto; showMeaning: boolean }) {
  const { card } = item;
  if (item.kind === 'drill' && item.drill) {
    const { drill } = item;
    return (
      <div className="grid place-items-center gap-2 text-center">
        <div className="flex items-center gap-1">
          <p className="text-3xl font-semibold break-words" lang={card.lang}>
            {card.lemma}
          </p>
          <SpeakButton text={card.lemma} lang={card.lang} />
        </div>
        <p className="text-sm text-muted-foreground">
          {card.translations.join(', ')} ·{' '}
          <WordMeta pos={card.pos} gender={card.gender} aspect={card.aspect} />
        </p>
        <p className="font-medium">→ {drill.label}</p>
        {drill.frame && (
          <>
            <p className="text-2xl font-medium" lang={card.lang}>
              {drill.frame.before}
              <span className="mx-1 inline-block min-w-16 border-b-2 border-primary align-baseline">
                <span className="sr-only">gap</span>
                &nbsp;
              </span>
              {drill.frame.after}
            </p>
            <p className="text-sm text-muted-foreground">{drill.frame.translation}</p>
          </>
        )}
      </div>
    );
  }
  if (item.kind === 'cloze' && item.cloze) {
    return (
      <div className="grid place-items-center gap-2 text-center">
        <p className="text-2xl leading-relaxed font-medium" lang={card.lang}>
          {item.cloze.before}
          <span className="mx-1 inline-block min-w-16 border-b-2 border-primary align-baseline">
            <span className="sr-only">gap</span>
            &nbsp;
          </span>
          {item.cloze.after}
        </p>
        {item.cloze.translation && (
          <p className="text-muted-foreground">{item.cloze.translation}</p>
        )}
        <p className="text-sm text-muted-foreground">
          The missing word means “{card.translations.join(', ')}”
        </p>
      </div>
    );
  }
  // With a picture, the meaning is optional: "name what you see".
  return (
    <div className="grid place-items-center gap-3 text-center">
      {card.image && (
        <img
          src={card.image.url}
          alt=""
          className="max-h-44 w-auto rounded-lg border object-cover sm:max-h-52"
        />
      )}
      {showMeaning && (
        <p className="text-3xl font-semibold break-words">{card.translations.join(', ')}</p>
      )}
      <WordMeta pos={card.pos} gender={card.gender} />
    </div>
  );
}

/**
 * Type the target word, from its meaning or picture (`type_word`) or into a sentence gap
 * (`cloze`). Buttons add letters a usual keyboard lacks. A hint reveals the first letters (and
 * makes the result count as Hard).
 */
export function TypeExercise({
  item,
  answered,
  onSubmit,
}: {
  item: LessonItemDto;
  answered: boolean;
  onSubmit: (text: string, hinted: boolean) => void;
}) {
  const { card } = item;
  const [text, setText] = useState('');
  const [hint, setHint] = useState(0);
  const [meaningShown, setMeaningShown] = useState(!card.image);
  const input = useRef<HTMLInputElement>(null);
  const answer = expectedAnswer(item);
  const letters = SPECIAL_LETTERS[card.lang] ?? '';

  const insert = (ch: string) => {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + ch + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + ch.length, start + ch.length);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!answered && text.trim()) onSubmit(text, hint > 0);
  };

  return (
    <div className="space-y-5">
      <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
        {item.kind === 'drill'
          ? 'Grammar'
          : item.kind === 'cloze'
            ? 'Fill in the gap'
            : card.image && !meaningShown
              ? 'Name what you see'
              : `Say it in ${languageName(card.lang)}`}
      </p>
      <Question item={item} showMeaning={meaningShown} />
      <form onSubmit={submit} className="space-y-2">
        <Input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          lang={card.lang}
          aria-label={`Your answer in ${languageName(card.lang)}`}
          placeholder={hint ? `${answer.slice(0, hint)}…` : 'Type your answer'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          readOnly={answered}
          className="h-12 text-lg"
        />
        {letters && !answered && (
          <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
            <legend className="sr-only">Insert a letter</legend>
            {[...letters].map((ch) => (
              <button
                key={ch}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(ch)}
                className="h-9 min-w-9 rounded-md border bg-card px-2 text-base shadow-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                lang={card.lang}
              >
                {ch}
              </button>
            ))}
          </fieldset>
        )}
        {!answered && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="h-11 flex-1 text-base" disabled={!text.trim()}>
              Check <span className="hidden text-xs opacity-70 sm:inline">(Enter)</span>
            </Button>
            {card.image && !meaningShown && item.kind === 'type_word' && (
              <Button type="button" variant="outline" onClick={() => setMeaningShown(true)}>
                <Eye /> Meaning
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={hint >= Math.max(1, [...answer].length - 1)}
              onClick={() => {
                setHint((h) => h + 1);
                input.current?.focus();
              }}
            >
              <Lightbulb /> Hint
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onSubmit('', true)}
            >
              I don’t know
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
