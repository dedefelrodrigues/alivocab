import { AI_PROVIDER_INFO, type ExamplesResultDto } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { api, errorMessage, unwrap } from '@/lib/api';
import { credentialsQuery } from '@/lib/queries';

const textareaClass =
  'w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

/**
 * Adds example sentences to theme words that have none (fill-in exercises need them), with a
 * saved API key or by copying the prompt into any AI chat and pasting the answer.
 */
export function ExamplesDialog({ themeId, onClose }: { themeId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: credentials } = useQuery(credentialsQuery);
  const [credentialId, setCredentialId] = useState('');
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);

  const prompt = useMutation({
    mutationFn: () => unwrap(api.themes[':id'].examples.prompt.$post({ param: { id: themeId } })),
    onError: (err) => toast.error(errorMessage(err)),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once when opened
  useEffect(() => {
    prompt.mutate();
  }, []);
  useEffect(() => {
    if (!credentialId && credentials?.[0]) setCredentialId(credentials[0].id);
  }, [credentials, credentialId]);

  const finished = (result: ExamplesResultDto) => {
    void queryClient.invalidateQueries({ queryKey: ['themes', themeId] });
    if (result.added) {
      toast.success(
        `Added ${result.added} sentence${result.added === 1 ? '' : 's'} for ${result.words} word${result.words === 1 ? '' : 's'}${result.remaining ? ` · ${result.remaining} still without one` : ''}`,
      );
    } else {
      toast.error(result.issues[0]?.message ?? 'No usable sentences in that answer');
    }
    if (result.remaining && result.added) prompt.mutate();
    else if (result.added) onClose();
    setRaw('');
  };

  const generate = useMutation({
    mutationFn: () =>
      unwrap(
        api.themes[':id'].examples.generate.$post({
          param: { id: themeId },
          json: { credentialId },
        }),
      ),
    onSuccess: finished,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const importRaw = useMutation({
    mutationFn: () =>
      unwrap(
        api.themes[':id'].examples.import.$post({
          param: { id: themeId },
          json: { raw, prompt: prompt.data?.prompt },
        }),
      ),
    onSuccess: finished,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const lemmas = prompt.data?.lemmas ?? [];
  const busy = generate.isPending || importRaw.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add example sentences</DialogTitle>
          <DialogDescription>
            Fill-in-the-gap exercises use a sentence for each word. These words don’t have one yet.
          </DialogDescription>
        </DialogHeader>

        {prompt.isPending ? (
          <p className="text-sm text-muted-foreground">Checking your words…</p>
        ) : lemmas.length === 0 ? (
          <p className="text-sm">Every word in this theme already has a sentence. 🎉</p>
        ) : (
          <div className="space-y-5">
            <p className="text-sm">
              <span className="font-medium">{lemmas.length} words:</span>{' '}
              <span className="text-muted-foreground">{lemmas.join(', ')}</span>
            </p>

            {credentials && credentials.length > 0 && (
              <section className="space-y-2">
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
                    {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Write
                    sentences
                  </Button>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-medium">
                {credentials?.length ? 'Or with any AI chat' : 'With any AI chat (free)'}
              </h3>
              <p className="text-xs text-muted-foreground">
                Copy the prompt into ChatGPT, Claude, Gemini or another chat, then paste its answer
                below.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(prompt.data?.prompt ?? '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    toast.error('Could not copy. Select the prompt below and copy it.');
                  }
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy prompt'}
              </Button>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Show the prompt</summary>
                <textarea
                  readOnly
                  aria-label="Prompt"
                  value={prompt.data?.prompt ?? ''}
                  rows={8}
                  className={`${textareaClass} mt-2 font-mono text-xs`}
                />
              </details>
              <textarea
                aria-label="The AI’s answer"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={5}
                placeholder="Paste the answer here"
                className={textareaClass}
              />
              <Button disabled={busy || !raw.trim()} onClick={() => importRaw.mutate()}>
                {importRaw.isPending && <Loader2 className="animate-spin" />} Save sentences
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
