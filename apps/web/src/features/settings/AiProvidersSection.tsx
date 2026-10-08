import {
  AI_PROVIDER_INFO,
  AI_PROVIDERS,
  type AiProvider,
  type CredentialDto,
  type CredentialTestResult,
} from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  KeyRound,
  Pencil,
  Plug,
  Plus,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage, unwrap } from '@/lib/api';
import { credentialsQuery, meQuery } from '@/lib/queries';
import { SettingsCard } from './SettingsCard';

type DialogState = { mode: 'create' } | { mode: 'edit'; credential: CredentialDto } | null;

export function AiProvidersSection() {
  const { data: credentials, isPending } = useQuery(credentialsQuery);
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <SettingsCard
      id="ai"
      title="AI providers"
      description="Optional. Keys are encrypted on the server and never shown again. Without a key you can still copy the prompt into any AI chat."
    >
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : credentials?.length ? (
        <ul className="divide-y rounded-lg border">
          {credentials.map((c) => (
            <CredentialRow
              key={c.id}
              credential={c}
              onEdit={() => setDialog({ mode: 'edit', credential: c })}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No providers yet. Tip: Google Gemini and OpenRouter offer free tiers.
        </p>
      )}
      <Button variant="outline" onClick={() => setDialog({ mode: 'create' })}>
        <Plus /> Add provider
      </Button>
      {dialog && <CredentialDialog state={dialog} onClose={() => setDialog(null)} />}
    </SettingsCard>
  );
}

function CredentialRow({
  credential: c,
  onEdit,
}: {
  credential: CredentialDto;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();

  const test = useMutation({
    mutationFn: () => unwrap(api.credentials[':id'].test.$post({ param: { id: c.id } })),
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(`${c.label}: ${r.message}`);
      void queryClient.invalidateQueries(credentialsQuery);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => unwrap(api.credentials[':id'].$delete({ param: { id: c.id } })),
    onSuccess: () => {
      toast.success(`${c.label} removed`);
      void queryClient.invalidateQueries(credentialsQuery);
      void queryClient.invalidateQueries(meQuery);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{c.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {AI_PROVIDER_INFO[c.provider].label}
          {c.keyLast4 && ` · ••••${c.keyLast4}`}
          {c.defaultModel && ` · ${c.defaultModel}`}
          {c.baseUrl && ` · ${c.baseUrl}`}
        </p>
      </div>
      {c.lastTestOk === true && (
        <Badge variant="outline" className="text-correct">
          <CircleCheck /> Works
        </Badge>
      )}
      {c.lastTestOk === false && (
        <Badge variant="outline" className="text-incorrect">
          <CircleX /> Failed
        </Badge>
      )}
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>
          <Plug /> {test.isPending ? 'Testing…' : 'Test'}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.label}`} onClick={onEdit}>
          <Pencil />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.label}`}>
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{c.label}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The encrypted key is removed permanently. Themes generated with it are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function CredentialDialog({
  state,
  onClose,
}: {
  state: NonNullable<DialogState>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = state.mode === 'edit' ? state.credential : null;
  const modelsListId = useId();

  const [provider, setProvider] = useState<AiProvider>(editing?.provider ?? 'google');
  const [label, setLabel] = useState(editing?.label ?? AI_PROVIDER_INFO.google.label);
  const [labelTouched, setLabelTouched] = useState(!!editing);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? '');
  const [defaultModel, setDefaultModel] = useState(editing?.defaultModel ?? '');
  const [testResult, setTestResult] = useState<CredentialTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const info = AI_PROVIDER_INFO[provider];

  const changeProvider = (p: AiProvider) => {
    setProvider(p);
    setTestResult(null);
    if (!labelTouched) setLabel(AI_PROVIDER_INFO[p].label);
  };

  const test = useMutation({
    mutationFn: async (): Promise<CredentialTestResult> => {
      if (editing && !apiKey) {
        return unwrap(api.credentials[':id'].test.$post({ param: { id: editing.id } }));
      }
      return unwrap(
        api.credentials.test.$post({
          json: { provider, label: label || 'test', apiKey, baseUrl: baseUrl || undefined },
        }),
      );
    },
    onSuccess: (r) => {
      setTestResult(r);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return unwrap(
          api.credentials[':id'].$patch({
            param: { id: editing.id },
            json: {
              label,
              defaultModel: defaultModel || null,
              baseUrl: info.needsBaseUrl ? baseUrl || null : undefined,
              ...(apiKey ? { apiKey } : {}),
            },
          }),
        );
      }
      return unwrap(
        api.credentials.$post({
          json: {
            provider,
            label,
            apiKey,
            baseUrl: baseUrl || undefined,
            defaultModel: defaultModel || undefined,
          },
        }),
      );
    },
    onSuccess: (c) => {
      toast.success(`${c.label} saved`);
      void queryClient.invalidateQueries(credentialsQuery);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.label}` : 'Add AI provider'}</DialogTitle>
          <DialogDescription>{info.hint}</DialogDescription>
        </DialogHeader>
        <form id="credential-form" onSubmit={onSubmit} className="grid gap-4">
          <FormField id="provider" label="Provider">
            <Select
              value={provider}
              onValueChange={(v) => changeProvider(v as AiProvider)}
              disabled={!!editing}
            >
              <SelectTrigger id="provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {AI_PROVIDER_INFO[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="label" label="Name">
            <Input
              id="label"
              value={label}
              maxLength={60}
              onChange={(e) => {
                setLabel(e.target.value);
                setLabelTouched(true);
              }}
            />
          </FormField>

          {info.needsBaseUrl && (
            <FormField
              id="baseUrl"
              label="Base URL"
              hint="For example https://my-server.example.com/v1"
            >
              <Input
                id="baseUrl"
                type="url"
                inputMode="url"
                placeholder="https://…/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </FormField>
          )}

          <FormField
            id="apiKey"
            label={
              editing
                ? 'Replace API key (optional)'
                : info.keyOptional
                  ? 'API key (optional)'
                  : 'API key'
            }
            hint={
              info.keyUrl ? (
                <a
                  href={info.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  Get a key <ExternalLink className="size-3" />
                </a>
              ) : null
            }
          >
            <Input
              id="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={editing?.keyLast4 ? `••••${editing.keyLast4}` : undefined}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
            />
          </FormField>

          <FormField
            id="defaultModel"
            label="Default model (optional)"
            hint={
              testResult?.models.length
                ? 'Suggestions loaded from your account.'
                : 'Run “Test connection” to load suggestions.'
            }
          >
            <Input
              id="defaultModel"
              list={modelsListId}
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="e.g. gemini-2.5-flash"
            />
            <datalist id={modelsListId}>
              {testResult?.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </FormField>

          {testResult && (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-correct' : 'text-incorrect'}`}
            >
              {testResult.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
              {testResult.message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            <Plug /> {test.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          <Button type="submit" form="credential-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
