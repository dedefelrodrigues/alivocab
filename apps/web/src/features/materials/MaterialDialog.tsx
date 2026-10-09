import { AI_PROVIDER_INFO, CEFR_LEVELS, type CefrLevel, type MaterialKind } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, Copy, Loader2, Sparkles } from 'lucide-react';
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

const textareaClass =
  'w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 space-y-1.5 border-0 p-0">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="inline-flex flex-wrap rounded-lg border p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              o.value === value
                ? 'bg-secondary font-medium text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Creates a listening script or grammar note for a theme: options, then either a saved API key
 * or copy the prompt into any AI chat and paste the answer.
 */
export function MaterialDialog({
  themeId,
  kind,
  onClose,
}: {
  themeId: string;
  kind: MaterialKind;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: credentials } = useQuery(credentialsQuery);
  const [style, setStyle] = useState<'dialogue' | 'story'>('dialogue');
  const [length, setLength] = useState<'short' | 'medium'>('short');
  const [level, setLevel] = useState<CefrLevel | 'auto'>('auto');
  const [focus, setFocus] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (!credentialId && credentials?.[0]) setCredentialId(credentials[0].id);
  }, [credentials, credentialId]);

  const options =
    kind === 'listening'
      ? { style, length, level: level === 'auto' ? null : level }
      : {
          level: level === 'auto' ? null : level,
          ...(focus.trim() ? { focus: focus.trim() } : {}),
        };

  const created = (material: { id: string }) => {
    void queryClient.invalidateQueries({ queryKey: ['themes', themeId, 'materials'] });
    toast.success(kind === 'listening' ? 'Listening ready' : 'Grammar note ready');
    onClose();
    void navigate({ to: '/materials/$materialId', params: { materialId: material.id } });
  };

  const generate = useMutation({
    mutationFn: () =>
      unwrap(
        api.themes[':id'].materials[':kind'].generate.$post({
          param: { id: themeId, kind },
          json: { credentialId, options },
        }),
      ),
    onSuccess: created,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const copyPrompt = useMutation({
    mutationFn: async () => {
      const r = await unwrap(
        api.themes[':id'].materials[':kind'].prompt.$post({
          param: { id: themeId, kind },
          json: { options },
        }),
      );
      setPrompt(r.prompt);
      await navigator.clipboard.writeText(r.prompt);
    },
    onSuccess: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    onError: (err) =>
      toast.error(
        err instanceof DOMException
          ? 'Could not copy. Open “Show the prompt” and copy it.'
          : errorMessage(err),
      ),
  });

  const importRaw = useMutation({
    mutationFn: () =>
      unwrap(
        api.themes[':id'].materials[':kind'].import.$post({
          param: { id: themeId, kind },
          json: { raw, options, prompt: prompt || undefined },
        }),
      ),
    onSuccess: created,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = generate.isPending || importRaw.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{kind === 'listening' ? 'New listening' : 'New grammar note'}</DialogTitle>
          <DialogDescription>
            {kind === 'listening'
              ? 'A short dialogue or story that uses the words you’re learning, to listen to and read.'
              : 'A short lesson on the grammar these words need, with examples from the theme.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {kind === 'listening' ? (
            <div className="flex flex-wrap gap-4">
              <Choice
                legend="Kind"
                value={style}
                onChange={setStyle}
                options={[
                  { value: 'dialogue', label: 'Dialogue' },
                  { value: 'story', label: 'Story' },
                ]}
              />
              <Choice
                legend="Length"
                value={length}
                onChange={setLength}
                options={[
                  { value: 'short', label: 'Short' },
                  { value: 'medium', label: 'Longer' },
                ]}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="grammar-focus" className="text-sm font-medium">
                Topic <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="grammar-focus"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="e.g. genitive after “nie ma”, verb aspect"
                maxLength={120}
              />
            </div>
          )}
          <Choice
            legend="Level"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'auto', label: 'Easy' },
              ...CEFR_LEVELS.map((l) => ({ value: l, label: l })),
            ]}
          />
        </div>

        {credentials && credentials.length > 0 && (
          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">With your API key</h3>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="API key"
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({AI_PROVIDER_INFO[c.provider].label} ···{c.keyLast4})
                  </option>
                ))}
              </select>
              <Button disabled={busy || !credentialId} onClick={() => generate.mutate()}>
                {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Write it
              </Button>
            </div>
            {generate.isPending && (
              <p role="status" className="text-xs text-muted-foreground motion-safe:animate-pulse">
                Writing… this can take up to a minute.
              </p>
            )}
          </section>
        )}

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">
            {credentials?.length ? 'Or with any AI chat' : 'With any AI chat (free)'}
          </h3>
          <p className="text-xs text-muted-foreground">
            Copy the prompt into ChatGPT, Claude, Gemini or another chat, then paste its answer
            below.
          </p>
          <Button
            variant="outline"
            disabled={copyPrompt.isPending}
            onClick={() => copyPrompt.mutate()}
          >
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy prompt'}
          </Button>
          {prompt && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Show the prompt</summary>
              <textarea
                readOnly
                aria-label="Prompt"
                value={prompt}
                rows={8}
                className={`${textareaClass} mt-2 font-mono text-xs`}
              />
            </details>
          )}
          <textarea
            aria-label="The AI’s answer"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={5}
            placeholder="Paste the answer here"
            className={textareaClass}
          />
          <Button disabled={busy || !raw.trim()} onClick={() => importRaw.mutate()}>
            {importRaw.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
