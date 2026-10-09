import { CEFR_LEVELS, type CefrLevel, type Scenario } from '@alivocab/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2, MessagesSquare, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, errorMessage, unwrap } from '@/lib/api';
import { credentialsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

const OWN = 'own';

/** Starts a role-play: pick one of three AI-suggested scenarios or describe your own. */
export function RoleplayDialog({ themeId, onClose }: { themeId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: credentials, isPending: loadingKeys } = useQuery(credentialsQuery);
  const hasKey = !!credentials?.length;
  const [choice, setChoice] = useState<number | typeof OWN | null>(null);
  const [own, setOwn] = useState({ title: '', description: '', userRole: '', aiRole: '' });
  const [level, setLevel] = useState<CefrLevel>('A2');

  const suggest = useMutation({
    mutationFn: () =>
      unwrap(api.themes[':id'].roleplay.suggest.$post({ param: { id: themeId }, json: {} })),
    onSuccess: () => setChoice(0),
    onError: (err) => toast.error(errorMessage(err)),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: suggest once a key is known
  useEffect(() => {
    if (hasKey) suggest.mutate();
  }, [hasKey]);

  const scenario: Scenario | null =
    choice === OWN
      ? own.title.trim() && own.description.trim()
        ? {
            title: own.title.trim(),
            description: own.description.trim(),
            userRole: own.userRole.trim() || 'myself',
            aiRole: own.aiRole.trim() || 'the other person',
          }
        : null
      : choice !== null
        ? (suggest.data?.scenarios[choice] ?? null)
        : null;

  const start = useMutation({
    mutationFn: (s: Scenario) =>
      unwrap(
        api.themes[':id'].roleplay.$post({ param: { id: themeId }, json: { scenario: s, level } }),
      ),
    onSuccess: (chat) => {
      onClose();
      void navigate({ to: '/roleplay/$chatId', params: { chatId: chat.id } });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New role-play</DialogTitle>
          <DialogDescription>
            Have a conversation in a situation from this theme. Your partner corrects your mistakes
            as you go.
          </DialogDescription>
        </DialogHeader>

        {loadingKeys ? null : !hasKey ? (
          <p className="text-sm">
            Role-play needs an AI to talk to. Add an API key in{' '}
            <Link to="/settings" hash="ai" className="underline" onClick={onClose}>
              Settings → AI providers
            </Link>{' '}
            (Google Gemini has a free tier).
          </p>
        ) : (
          <div className="space-y-4">
            <fieldset className="m-0 space-y-2 border-0 p-0">
              <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
                Choose a situation
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={suggest.isPending}
                  onClick={() => suggest.mutate()}
                >
                  <RefreshCw className={cn(suggest.isPending && 'animate-spin')} /> Other ideas
                </Button>
              </legend>
              {suggest.isPending && !suggest.data && (
                <p
                  role="status"
                  className="text-sm text-muted-foreground motion-safe:animate-pulse"
                >
                  Thinking of situations…
                </p>
              )}
              {suggest.data?.scenarios.map((s, i) => (
                <label
                  key={s.title}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                    choice === i ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    name="scenario"
                    checked={choice === i}
                    onChange={() => setChoice(i)}
                    className="mt-1 accent-primary"
                  />
                  <span className="space-y-0.5">
                    <span className="block font-medium">{s.title}</span>
                    <span className="block text-sm text-muted-foreground">{s.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      You: {s.userRole} · Partner: {s.aiRole}
                    </span>
                  </span>
                </label>
              ))}
              <label
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                  choice === OWN ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <input
                  type="radio"
                  name="scenario"
                  checked={choice === OWN}
                  onChange={() => setChoice(OWN)}
                  className="mt-1 accent-primary"
                />
                <span className="block font-medium">My own situation</span>
              </label>
              {choice === OWN && (
                <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                  <Input
                    aria-label="Title"
                    placeholder="Title, e.g. Ordering a birthday cake"
                    value={own.title}
                    maxLength={80}
                    onChange={(e) => setOwn((o) => ({ ...o, title: e.target.value }))}
                    className="sm:col-span-2"
                  />
                  <Input
                    aria-label="What happens"
                    placeholder="What happens and what you want to achieve"
                    value={own.description}
                    maxLength={400}
                    onChange={(e) => setOwn((o) => ({ ...o, description: e.target.value }))}
                    className="sm:col-span-2"
                  />
                  <Input
                    aria-label="You are"
                    placeholder="You are… (e.g. a customer)"
                    value={own.userRole}
                    maxLength={80}
                    onChange={(e) => setOwn((o) => ({ ...o, userRole: e.target.value }))}
                  />
                  <Input
                    aria-label="Your partner is"
                    placeholder="Your partner is… (e.g. the baker)"
                    value={own.aiRole}
                    maxLength={80}
                    onChange={(e) => setOwn((o) => ({ ...o, aiRole: e.target.value }))}
                  />
                </div>
              )}
            </fieldset>

            <fieldset className="m-0 space-y-1.5 border-0 p-0">
              <legend className="text-sm font-medium">Level</legend>
              <div className="inline-flex flex-wrap rounded-lg border p-0.5">
                {CEFR_LEVELS.map((l) => (
                  <label
                    key={l}
                    className={cn(
                      'cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                      l === level
                        ? 'bg-secondary font-medium text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={l === level}
                      onChange={() => setLevel(l)}
                    />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>

            <Button
              className="w-full"
              disabled={!scenario || start.isPending}
              onClick={() => scenario && start.mutate(scenario)}
            >
              {start.isPending ? <Loader2 className="animate-spin" /> : <MessagesSquare />} Start
              the conversation
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
