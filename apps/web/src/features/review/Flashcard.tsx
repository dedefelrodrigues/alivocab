import { GENDER_LABELS, type ReviewCardDto } from '@alivocab/shared';
import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { WordMeta } from '@/features/themes/WordMeta';
import { cn } from '@/lib/utils';

function CardPicture({ card, size }: { card: ReviewCardDto; size: 'sm' | 'lg' }) {
  if (!card.image) return null;
  return (
    <img
      src={card.image.url}
      alt=""
      className={cn(
        'mx-auto w-auto rounded-lg border object-cover',
        size === 'lg' ? 'max-h-40 sm:max-h-48' : 'max-h-28 sm:max-h-32',
      )}
    />
  );
}

/** The example sentence with the target word blanked out (a recall hint). */
function clozeHint(card: ReviewCardDto): string | null {
  const ex = card.examples.find((e) => e.cloze && e.text.includes(e.cloze));
  if (ex?.cloze) return ex.text.replace(ex.cloze, '_'.repeat(Math.max(3, ex.cloze.length)));
  return null;
}

function Front({ card }: { card: ReviewCardDto }) {
  const [hint, setHint] = useState(false);
  if (card.direction === 'recognition') {
    return (
      <div className="grid place-items-center gap-3 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">What does it mean?</p>
        <div className="flex items-center gap-1">
          <p className="text-4xl font-semibold break-words sm:text-5xl" lang={card.lang}>
            {card.lemma}
          </p>
          <SpeakButton text={card.lemma} lang={card.lang} />
        </div>
        <WordMeta pos={card.pos} gender={card.gender} aspect={card.aspect} />
      </div>
    );
  }
  const cloze = clozeHint(card);
  return (
    <div className="grid place-items-center gap-3 text-center">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Say it in the language you learn
      </p>
      <CardPicture card={card} size="lg" />
      <p className="text-3xl font-semibold break-words sm:text-4xl">
        {card.translations.join(', ')}
      </p>
      <WordMeta pos={card.pos} />
      {hint ? (
        <p className="text-sm text-muted-foreground" lang={card.lang}>
          {cloze ?? `Starts with “${card.lemma.slice(0, 1)}…”`}
        </p>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setHint(true);
          }}
        >
          <Lightbulb /> Hint
        </Button>
      )}
    </div>
  );
}

function Back({ card }: { card: ReviewCardDto }) {
  return (
    <div className="grid gap-4 text-center">
      <CardPicture card={card} size="sm" />
      <div className="grid place-items-center gap-1">
        <div className="flex items-center gap-1">
          <p className="text-4xl font-semibold break-words sm:text-5xl" lang={card.lang}>
            {card.lemma}
          </p>
          <SpeakButton text={card.lemma} lang={card.lang} />
        </div>
        <p className="text-xl">{card.translations.join(', ')}</p>
        <p className="text-sm text-muted-foreground">
          <WordMeta
            pos={card.pos}
            gender={card.gender}
            aspect={card.aspect}
            aspectPair={card.aspectPair}
          />
          {card.gender && <span className="sr-only"> ({GENDER_LABELS[card.gender]})</span>}
          {card.pronunciation && <span> · /{card.pronunciation}/</span>}
        </p>
      </div>
      {card.forms && (
        <p className="text-sm text-muted-foreground" lang={card.lang}>
          {Object.values(card.forms).join(' · ')}
        </p>
      )}
      {card.examples.map((ex) => (
        <div key={ex.text} className="flex items-start justify-center gap-1 text-left text-sm">
          <SpeakButton text={ex.text} lang={card.lang} />
          <p>
            <span lang={card.lang}>{ex.text}</span>
            {ex.translation && (
              <span className="block text-muted-foreground">{ex.translation}</span>
            )}
          </p>
        </div>
      ))}
      {(card.note || card.mnemonic) && (
        <p className="rounded-md bg-muted/60 p-2 text-sm">
          {card.note}
          {card.note && card.mnemonic && <br />}
          {card.mnemonic && <>💡 {card.mnemonic}</>}
        </p>
      )}
    </div>
  );
}

/**
 * Two-sided card with a 3D flip (no animation with reduced motion). Both faces share one grid
 * cell, so the card is as tall as the larger face and nothing jumps when it flips.
 */
export function Flashcard({
  card,
  revealed,
  onReveal,
}: {
  card: ReviewCardDto;
  revealed: boolean;
  onReveal: () => void;
}) {
  const face =
    'col-start-1 row-start-1 flex min-h-64 items-center justify-center rounded-2xl border p-6 shadow-sm [backface-visibility:hidden] sm:min-h-80';
  return (
    <div className="[perspective:1200px]">
      {/* Tapping the card is a mouse/touch shortcut; keyboard users use the "Show answer" button. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard path is the Show answer button / Space */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
      <div
        onClick={() => !revealed && onReveal()}
        className={cn(
          'grid cursor-pointer [transform-style:preserve-3d] motion-safe:transition-transform motion-safe:duration-500',
          revealed && '[transform:rotateY(180deg)] cursor-default',
        )}
      >
        <div className={cn(face, 'bg-flashcard-front')} aria-hidden={revealed}>
          <Front card={card} />
        </div>
        <div
          className={cn(face, 'bg-flashcard-back [transform:rotateY(180deg)]')}
          aria-hidden={!revealed}
        >
          {revealed && <Back card={card} />}
        </div>
      </div>
    </div>
  );
}
