import { AI_PROVIDER_INFO } from '@alivocab/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bot, Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, errorMessage, unwrap } from '@/lib/api';
import { credentialsQuery } from '@/lib/queries';
import type { SourceProps } from './types';

function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return setSeconds(0);
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}

export function ApiPanel({
  setup,
  ensureValid,
  onProposal,
  preferredCredentialId,
}: SourceProps & { preferredCredentialId?: string }) {
  const { data: credentials, isPending } = useQuery(credentialsQuery);
  const [credentialId, setCredentialId] = useState<string | undefined>(preferredCredentialId);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const modelsId = useId();

  const credential = credentials?.find((c) => c.id === credentialId) ?? credentials?.[0];
  const defaultModel = credential
    ? (credential.defaultModel ?? AI_PROVIDER_INFO[credential.provider].defaultModel ?? '')
    : '';

  // Reset the model field when switching keys.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run only when the credential changes
  useEffect(() => {
    setModel(defaultModel);
    setModels([]);
  }, [credential?.id]);

  const loadModels = useMutation({
    mutationFn: (id: string) => unwrap(api.credentials[':id'].test.$post({ param: { id } })),
    onSuccess: (r) => (r.ok ? setModels(r.models) : toast.error(r.message)),
  });

  const generate = useMutation({
    mutationFn: () => {
      if (!credential) throw new Error('Choose an API key');
      return unwrap(
        api.generate.$post({
          json: {
            themeName: setup.themeName,
            description: setup.description || undefined,
            themeId: setup.themeId,
            count: setup.count,
            level: setup.level,
            credentialId: credential.id,
            model: model.trim() || undefined,
          },
        }),
      );
    },
    onSuccess: onProposal,
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  });
  const elapsed = useElapsed(generate.isPending);

  if (isPending) return null;
  if (!credentials?.length || !credential) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No API key yet. Add one in{' '}
        <Link
          to="/settings"
          hash="ai"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Settings → AI providers
        </Link>{' '}
        (Google Gemini has a free tier), or use the copy &amp; paste tab.
      </div>
    );
  }

  const needsModel = !model.trim();
  const batches = Math.ceil(setup.count / 25);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="credential" label="API key">
          <Select value={credential.id} onValueChange={setCredentialId}>
            <SelectTrigger id="credential" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {credentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          id="model"
          label="Model"
          error={needsModel ? 'Choose a model for this provider' : null}
          hint={
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => loadModels.mutate(credential.id)}
              disabled={loadModels.isPending}
            >
              {loadModels.isPending
                ? 'Loading models…'
                : models.length
                  ? `${models.length} models loaded`
                  : 'Load available models'}
            </button>
          }
        >
          <Input
            id="model"
            list={modelsId}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model id"
          />
          <datalist id={modelsId}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </FormField>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {generate.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Generating {setup.count} words{batches > 1 ? ` in ${batches} batches` : ''}… {elapsed}s
          </p>
        )}
        <Button
          type="button"
          onClick={() => ensureValid() && generate.mutate()}
          disabled={generate.isPending || needsModel}
        >
          {generate.isPending ? <Loader2 className="animate-spin" /> : <Bot />}
          Generate {setup.count} words
        </Button>
      </div>
    </div>
  );
}
