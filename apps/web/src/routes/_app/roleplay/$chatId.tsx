import { parseRoleplayTurn, SPECIAL_LETTERS } from '@alivocab/core';
import type { RoleplayDto, RoleplayMessage } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Flag,
  Languages,
  Loader2,
  Mic,
  MicOff,
  PencilLine,
  RotateCcw,
  Send,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { reportProblem } from '@/lib/activity';
import { api, errorMessage, unwrap } from '@/lib/api';
import { meQuery, roleplayQuery } from '@/lib/queries';
import { speak, stopSpeaking } from '@/lib/speech';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/roleplay/$chatId')({ component: RoleplayPage });

const AUTOPLAY_KEY = 'alivocab.review.autoplay';

function readAutoplay(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** A turn being streamed: the learner's message (if any) and the partner's answer so far. */
type Pending = { userText: string | null; raw: string };
/** A turn that didn't go through (nothing was saved), shown in the chat with a retry. */
type Failed = { userText: string | null; message: string };

function RoleplayPage() {
  const { chatId } = Route.useParams();
  const { data: chat, isPending, error } = useQuery(roleplayQuery(chatId));
  if (isPending) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (error || !chat)
    return <p className="text-incorrect">Could not load the chat: {errorMessage(error)}</p>;
  return <Chat chat={chat} />;
}

function Chat({ chat }: { chat: RoleplayDto }) {
  const queryClient = useQueryClient();
  const { scenario, messages, finishedAt } = chat.content;
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const { data: me } = useQuery(meQuery);
  const [input, setInput] = useState('');
  const [shownTranslations, setShownTranslations] = useState<Set<number>>(() => new Set());
  const [autoplay, setAutoplay] = useState(readAutoplay);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const opened = useRef(false);
  const mic = useSpeechRecognition(chat.lang, setInput);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['roleplay', chat.id] }),
    [queryClient, chat.id],
  );

  const send = useCallback(
    async (text: string | null) => {
      setFailed(null);
      setPending({ userText: text, raw: '' });
      let raw = '';
      // Failures the server already logged (an error answer, a failed model) aren't reported again.
      let serverKnows = false;
      try {
        const res = await fetch(`/api/roleplay/${encodeURIComponent(chat.id)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(text ? { text } : {}),
        }).catch(() => {
          throw new Error('Could not reach the server. Check your connection.');
        });
        if (!res.ok || !res.body) {
          serverKnows = true;
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read().catch(() => {
            throw new Error('The connection broke while the partner was answering.');
          });
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          setPending({ userText: text, raw });
        }
        const turn = parseRoleplayTurn(raw);
        if (turn.error) {
          serverKnows = true;
          throw new Error(turn.error);
        }
        if (!turn.reply) throw new Error('The partner didn’t answer.');
        if (autoplay) void speak(turn.reply, chat.lang);
        // The server saves the turn before the stream ends.
        await refresh();
      } catch (err) {
        const message = errorMessage(err);
        setFailed({ userText: text, message });
        if (text) setInput(text);
        if (!serverKnows) {
          reportProblem(message, {
            context: 'role-play',
            details: { chatId: chat.id, sent: text, received: raw.slice(0, 2000) },
          });
        }
      } finally {
        setPending(null);
      }
    },
    [chat.id, chat.lang, autoplay, refresh],
  );

  // The partner opens a new chat.
  useEffect(() => {
    if (!messages.length && !finishedAt && !opened.current) {
      opened.current = true;
      void send(null);
    }
  }, [messages.length, finishedAt, send]);

  // Keep the newest message in view as messages arrive and replies stream in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on new content on purpose
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, pending?.raw]);

  useEffect(() => stopSpeaking, []);

  const submit = () => {
    const text = input.trim();
    if (!text || pending) return;
    mic.stop();
    setInput('');
    void send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const finish = useMutation({
    mutationFn: () => unwrap(api.roleplay[':id'].finish.$post({ param: { id: chat.id } })),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggleAutoplay = () =>
    setAutoplay((on) => {
      try {
        localStorage.setItem(AUTOPLAY_KEY, String(!on));
      } catch {
        // Not persisted in private mode.
      }
      return !on;
    });

  const insert = (ch: string) => {
    const el = field.current;
    const at = el?.selectionStart ?? input.length;
    const to = el?.selectionEnd ?? input.length;
    setInput(input.slice(0, at) + ch + input.slice(to));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + ch.length, at + ch.length);
    });
  };

  const live = pending ? parseRoleplayTurn(pending.raw) : null;
  const corrections = messages.filter(
    (m): m is Extract<RoleplayMessage, { role: 'user' }> => m.role === 'user' && !!m.correction,
  );
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const letters = SPECIAL_LETTERS[chat.lang] ?? '';

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <div className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to the theme">
          {chat.themeId ? (
            <Link to="/themes/$themeId" params={{ themeId: chat.themeId }}>
              <ArrowLeft />
            </Link>
          ) : (
            <Link to="/themes">
              <ArrowLeft />
            </Link>
          )}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Role-play</p>
          <h1 className="text-xl font-bold tracking-tight">{scenario.title}</h1>
          <p className="text-sm text-muted-foreground">
            {scenario.description} You: {scenario.userRole} · Partner: {scenario.aiRole}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={autoplay}
          aria-label={autoplay ? 'Stop reading replies aloud' : 'Read replies aloud'}
          onClick={toggleAutoplay}
        >
          {autoplay ? <Volume2 /> : <VolumeX />}
        </Button>
      </div>

      <ol className="flex-1 space-y-3" aria-label="Conversation">
        {messages.map((m, i) =>
          m.role === 'assistant' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: messages only grow
            <li key={i} className="max-w-[85%] space-y-1">
              <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-2.5">
                <p className="text-lg" lang={chat.lang}>
                  {m.text}
                </p>
                {shownTranslations.has(i) && m.translation && (
                  <p className="text-sm text-muted-foreground">{m.translation}</p>
                )}
              </div>
              <div className="flex gap-1">
                <SpeakButton text={m.text} lang={chat.lang} />
                {m.translation && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={shownTranslations.has(i)}
                    aria-label={shownTranslations.has(i) ? 'Hide translation' : 'Show translation'}
                    onClick={() =>
                      setShownTranslations((s) => {
                        const next = new Set(s);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  >
                    <Languages />
                  </Button>
                )}
              </div>
            </li>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: messages only grow
            <li key={i} className="ml-auto max-w-[85%] space-y-1">
              <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
                <p lang={chat.lang}>{m.text}</p>
              </div>
              <CorrectionNote message={m} lang={chat.lang} />
            </li>
          ),
        )}

        {pending?.userText && (
          <li className="ml-auto max-w-[85%] space-y-1">
            <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
              <p lang={chat.lang}>{pending.userText}</p>
            </div>
            {live?.corrected && (
              <CorrectionNote
                message={{
                  role: 'user',
                  text: pending.userText,
                  correction: { corrected: live.corrected, explanation: live.explanation },
                }}
                lang={chat.lang}
              />
            )}
          </li>
        )}
        {pending && (
          <li className="max-w-[85%]">
            <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-2.5">
              {live?.replyStarted && live.reply ? (
                <p className="text-lg" lang={chat.lang}>
                  {live.reply}
                </p>
              ) : (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {scenario.aiRole} is typing…
                </p>
              )}
            </div>
          </li>
        )}
        {failed && !pending && (
          <li className="space-y-2" role="alert">
            {failed.userText && (
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed px-4 py-2.5 text-muted-foreground">
                <p lang={chat.lang}>{failed.userText}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-incorrect/40 bg-incorrect/10 px-3 py-2 text-sm">
              <TriangleAlert className="size-4 shrink-0 text-incorrect" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">
                  {failed.userText ? 'Not sent. ' : 'The partner didn’t answer. '}
                </span>
                {failed.message}
              </p>
              {me?.profile.advancedMode && (
                <Button asChild variant="ghost" size="sm">
                  <Link to="/log">See the log</Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (failed.userText) setInput('');
                  void send(failed.userText);
                }}
              >
                <RotateCcw /> Try again
              </Button>
            </div>
          </li>
        )}
        <div ref={end} />
      </ol>

      {finishedAt ? (
        <Summary chat={chat} corrections={corrections} />
      ) : (
        <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur">
          {letters && (
            <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
              <legend className="sr-only">Insert a letter</legend>
              {[...letters].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(ch)}
                  className="h-8 min-w-8 rounded-md border bg-card px-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  lang={chat.lang}
                >
                  {ch}
                </button>
              ))}
            </fieldset>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={field}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              lang={chat.lang}
              aria-label="Your message"
              placeholder={mic.listening ? 'Listening…' : 'Write your answer'}
              maxLength={1000}
              disabled={!!pending}
              className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none rounded-xl border bg-transparent px-3 py-2.5 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
            {mic.supported && (
              <Button
                type="button"
                variant={mic.listening ? 'default' : 'outline'}
                size="icon"
                className="size-11"
                aria-pressed={mic.listening}
                aria-label={mic.listening ? 'Stop listening' : 'Speak your answer'}
                disabled={!!pending}
                onClick={() => (mic.listening ? mic.stop() : mic.start())}
              >
                {mic.listening ? <MicOff /> : <Mic />}
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              className="size-11"
              aria-label="Send"
              disabled={!input.trim() || !!pending}
              onClick={submit}
            >
              <Send />
            </Button>
          </div>
          {mic.error && <p className="text-xs text-incorrect">{mic.error}</p>}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!userTurns || !!pending || finish.isPending}
              onClick={() => finish.mutate()}
            >
              <Flag /> End and review
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Under a learner's message: the corrected version and why, or a quiet "looks right". */
function CorrectionNote({
  message,
  lang,
}: {
  message: Extract<RoleplayMessage, { role: 'user' }>;
  lang: string;
}) {
  if (!message.correction) {
    return (
      <p className="flex items-center justify-end gap-1 text-xs text-correct">
        <Check className="size-3.5" aria-hidden /> Looks right
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-status-recognize/40 bg-status-recognize/10 px-3 py-2 text-sm">
      <p className="flex items-start gap-1.5">
        <PencilLine
          className="mt-0.5 size-4 shrink-0 text-status-recognize"
          aria-label="Correction"
        />
        <span lang={lang} className="font-medium">
          {message.correction.corrected}
        </span>
      </p>
      {message.correction.explanation && (
        <p className="mt-0.5 pl-5.5 text-muted-foreground">{message.correction.explanation}</p>
      )}
    </div>
  );
}

/** After ending: every correction in one place, and the theme words used. */
function Summary({
  chat,
  corrections,
}: {
  chat: RoleplayDto;
  corrections: Array<Extract<RoleplayMessage, { role: 'user' }>>;
}) {
  const userTurns = chat.content.messages.filter((m) => m.role === 'user').length;
  return (
    <section className="space-y-4 rounded-2xl border p-5" aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="flex items-center gap-2 text-lg font-semibold">
        <CircleCheck className="size-5 text-primary" aria-hidden /> Conversation done
      </h2>
      <p className="text-sm text-muted-foreground">
        {userTurns} message{userTurns === 1 ? '' : 's'} from you · {userTurns - corrections.length}{' '}
        without corrections
      </p>
      {corrections.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">To remember</h3>
          <ul className="space-y-2">
            {corrections.map((m) => (
              <li key={m.text} className="rounded-lg border p-3 text-sm">
                <p
                  className="text-muted-foreground line-through decoration-incorrect"
                  lang={chat.lang}
                >
                  {m.text}
                </p>
                <p className="flex items-center gap-1 font-medium" lang={chat.lang}>
                  {m.correction?.corrected}
                  {m.correction?.corrected && (
                    <SpeakButton text={m.correction.corrected} lang={chat.lang} />
                  )}
                </p>
                {m.correction?.explanation && (
                  <p className="text-muted-foreground">{m.correction.explanation}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {chat.words.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Theme words used</h3>
          <ul className="flex flex-wrap gap-2">
            {chat.words.map((w) => (
              <li
                key={w.lexemeId}
                className={cn('rounded-full border bg-card px-3 py-0.5 text-sm')}
                lang={chat.lang}
              >
                {w.lemma} <span className="text-muted-foreground">{w.translations[0]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {chat.themeId && (
        <Button asChild variant="outline">
          <Link to="/themes/$themeId" params={{ themeId: chat.themeId }}>
            Back to the theme
          </Link>
        </Button>
      )}
    </section>
  );
}
