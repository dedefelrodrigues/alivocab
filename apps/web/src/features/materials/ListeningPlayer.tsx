import { CLOUD_TTS, cloudVoice, type ListeningScript, type MaterialDto } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Languages, Pause, Play, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useVoices } from '@/hooks/useVoices';
import { meQuery } from '@/lib/queries';
import { speak, stopSpeaking } from '@/lib/speech';
import { cn } from '@/lib/utils';

const RATES = [0.75, 1, 1.25] as const;
/** Pause between lines when playing everything (ms). */
const GAP_MS = 400;

/** A different voice per speaker, so a dialogue sounds like two people. */
function useSpeakerVoices(lang: string, speakerCount: number) {
  const { data: me } = useQuery(meQuery);
  const { voices } = useVoices(lang);
  const provider = me?.profile.ttsProvider ?? 'browser';
  const main = me?.profile.ttsVoice ?? null;
  return (speakerIndex: number): string | undefined => {
    if (speakerIndex <= 0 || speakerCount < 2) return undefined;
    if (provider !== 'browser') {
      const mainVoice = cloudVoice(provider, main);
      const others = CLOUD_TTS[provider].voices.filter((v) => v !== mainVoice);
      return others[((speakerIndex - 1) * 3) % others.length];
    }
    const others = voices.filter((v) => v.voiceURI !== main);
    return others[(speakerIndex - 1) % Math.max(1, others.length)]?.voiceURI;
  };
}

/**
 * Plays a script line by line with the learner's voices (one per speaker), at three speeds.
 * The text is hidden at first, to listen before reading; translations can be shown too.
 * Comprehension questions are checked in place.
 */
export function ListeningPlayer({
  material,
  onListened,
}: {
  material: MaterialDto & { kind: 'listening' };
  onListened: () => void;
}) {
  const script: ListeningScript = material.content;
  const [current, setCurrent] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [showText, setShowText] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const run = useRef(0);
  const speakerIndex = new Map(script.speakers.map((s, i) => [s.id, i]));
  const speakerName = new Map(script.speakers.map((s) => [s.id, s.name]));
  const voiceFor = useSpeakerVoices(material.lang, script.speakers.length);

  const stop = useCallback(() => {
    run.current++;
    stopSpeaking();
    setCurrent(null);
    setPlayingAll(false);
  }, []);
  useEffect(() => stop, [stop]);

  const sayLine = (i: number) => {
    const line = script.lines[i];
    if (!line) return Promise.resolve();
    return speak(line.text, material.lang, {
      voice: voiceFor(speakerIndex.get(line.speaker) ?? 0),
      rate,
    });
  };

  const playFrom = async (start: number) => {
    const me = ++run.current;
    setPlayingAll(true);
    for (let i = start; i < script.lines.length; i++) {
      if (run.current !== me) return;
      setCurrent(i);
      await sayLine(i);
      if (run.current !== me) return;
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    if (run.current !== me) return;
    setCurrent(null);
    setPlayingAll(false);
    onListened();
  };

  const playOne = async (i: number) => {
    const me = ++run.current;
    setPlayingAll(false);
    setCurrent(i);
    await sayLine(i);
    if (run.current === me) setCurrent(null);
  };

  const score = script.questions.filter((q, i) => answers[i] === q.answer).length;

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        {playingAll ? (
          <Button onClick={stop}>
            <Pause /> Pause
          </Button>
        ) : (
          <Button onClick={() => void playFrom(current ?? 0)}>
            <Play /> {current === null ? 'Play all' : 'Resume'}
          </Button>
        )}
        <fieldset className="m-0 inline-flex rounded-lg border p-0.5">
          <legend className="sr-only">Speed</legend>
          {RATES.map((r) => (
            <label
              key={r}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-sm tabular-nums has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                r === rate
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                checked={r === rate}
                onChange={() => setRate(r)}
              />
              {r}×
            </label>
          ))}
        </fieldset>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={showText}
          onClick={() => setShowText((v) => !v)}
        >
          {showText ? <EyeOff /> : <Eye />} {showText ? 'Hide text' : 'Show text'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={showTranslation}
          onClick={() => setShowTranslation((v) => !v)}
        >
          <Languages /> {showTranslation ? 'Hide translation' : 'Translation'}
        </Button>
      </div>

      <ol className="space-y-2">
        {script.lines.map((line, i) => {
          const idx = speakerIndex.get(line.speaker) ?? 0;
          const active = current === i;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are a fixed list
            <li key={i}>
              <div
                className={cn(
                  'flex items-start gap-2 rounded-xl border p-3 transition-colors',
                  active ? 'border-primary bg-primary/5' : 'bg-card',
                  script.speakers.length > 1 && idx % 2 === 1 && 'sm:ml-10',
                  script.speakers.length > 1 && idx % 2 === 0 && 'sm:mr-10',
                )}
                aria-current={active ? 'true' : undefined}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Play line ${i + 1}`}
                  onClick={() => void playOne(i)}
                >
                  <Volume2 />
                </Button>
                <div className="min-w-0 flex-1">
                  {script.speakers.length > 1 && (
                    <p className="text-xs font-medium text-muted-foreground">
                      {speakerName.get(line.speaker) ?? line.speaker}
                    </p>
                  )}
                  {showText ? (
                    <p className="text-lg" lang={material.lang}>
                      {line.text}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Line {i + 1} · listen first
                    </p>
                  )}
                  {showTranslation && line.translation && (
                    <p className="text-sm text-muted-foreground">{line.translation}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {script.questions.length > 0 && (
        <section className="space-y-3" aria-labelledby="questions-heading">
          <h2 id="questions-heading" className="font-semibold">
            Did you understand?
          </h2>
          {script.questions.map((q, qi) => (
            <fieldset key={q.question} className="m-0 space-y-1.5 rounded-xl border p-3">
              <legend className="px-1 text-sm font-medium">{q.question}</legend>
              {q.options.map((option, oi) => {
                const chosen = answers[qi] === oi;
                const right = q.answer === oi;
                return (
                  <label
                    key={option}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                      checked && right && 'bg-correct/10',
                      checked && chosen && !right && 'bg-incorrect/10',
                    )}
                  >
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={chosen}
                      disabled={checked}
                      onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                      className="accent-primary"
                    />
                    <span className="flex-1">{option}</span>
                    {checked && right && (
                      <Check className="size-4 text-correct" aria-label="Right answer" />
                    )}
                    {checked && chosen && !right && (
                      <X className="size-4 text-incorrect" aria-label="Your answer" />
                    )}
                  </label>
                );
              })}
            </fieldset>
          ))}
          {checked ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="font-medium">
                {score} of {script.questions.length} right
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setChecked(false);
                  setAnswers({});
                }}
              >
                Try again
              </Button>
            </div>
          ) : (
            <Button
              disabled={Object.keys(answers).length < script.questions.length}
              onClick={() => {
                setChecked(true);
                onListened();
              }}
            >
              Check answers
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
