import { parseVocabulary } from '@alivocab/core';
import type { ProposalFormat } from '@alivocab/shared';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Sparkles } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/hooks/useLanguages';
import { api, errorMessage, unwrap } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { SourceProps } from './types';

const CHATS = [
  { label: 'ChatGPT', href: 'https://chatgpt.com/' },
  { label: 'Claude', href: 'https://claude.ai/new' },
  { label: 'Gemini', href: 'https://gemini.google.com/app' },
];

const textareaClass =
  'w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

export function CopyPromptPanel({
  setup,
  ensureValid,
  onProposal,
  initialRaw,
}: SourceProps & { initialRaw: string | null }) {
  const language = useLanguage(setup.lang);
  const [format, setFormat] = useState<ProposalFormat>('json');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState(initialRaw ?? '');
  const deferredRaw = useDeferredValue(raw);

  const preview = useMemo(() => {
    if (!deferredRaw.trim() || !language) return null;
    return parseVocabulary(deferredRaw, { lang: language.lang, nativeLang: language.nativeLang });
  }, [deferredRaw, language]);

  const buildPrompt = useMutation({
    mutationFn: () =>
      unwrap(
        api.generate.prompt.$post({
          json: {
            themeName: setup.themeName,
            description: setup.description || undefined,
            themeId: setup.themeId,
            lang: setup.lang,
            count: setup.count,
            level: setup.level,
            format,
          },
        }),
      ),
    onSuccess: (r) => setPrompt(r.prompt),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.generate.import.$post({
          json: {
            raw,
            source: 'manual',
            themeName: setup.themeName,
            themeId: setup.themeId,
            lang: setup.lang,
            prompt: prompt ?? undefined,
          },
        }),
      ),
    onSuccess: onProposal,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  };

  const errors = preview?.issues.filter((i) => i.severity === 'error').length ?? 0;

  return (
    <div className="grid gap-5">
      <ol className="grid gap-5">
        <li className="grid gap-3">
          <p className="text-sm">
            <span className="font-medium">a)</span> Create the prompt, then paste it into any AI
            chat you use (free accounts work).
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <FormField id="format" label="Answer format">
              <Select value={format} onValueChange={(v) => setFormat(v as ProposalFormat)}>
                <SelectTrigger id="format" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON (recommended)</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <Button
              type="button"
              onClick={() => ensureValid() && buildPrompt.mutate()}
              disabled={buildPrompt.isPending}
            >
              <Sparkles /> {prompt ? 'Update prompt' : 'Create prompt'}
            </Button>
          </div>
          {prompt && (
            <div className="grid gap-2">
              <textarea
                readOnly
                aria-label="Prompt"
                value={prompt}
                rows={8}
                onFocus={(e) => e.currentTarget.select()}
                className={cn(textareaClass, 'font-mono text-xs')}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy prompt'}
                </Button>
                {CHATS.map((c) => (
                  <Button key={c.label} asChild variant="ghost" size="sm">
                    <a href={c.href} target="_blank" rel="noreferrer">
                      {c.label} <ExternalLink />
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </li>
        <li className="grid gap-2">
          <label htmlFor="raw" className="text-sm">
            <span className="font-medium">b)</span> Paste the AI’s answer here. JSON, CSV, a table
            or simple “word – translation” lines all work.
          </label>
          <textarea
            id="raw"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={'{"words":[…]}  or  chleb – bread'}
            className={cn(textareaClass, 'font-mono text-xs')}
          />
          {preview && (
            <p
              role="status"
              className={cn(
                'text-sm',
                preview.words.length ? 'text-muted-foreground' : 'text-incorrect',
              )}
            >
              {preview.words.length
                ? `Found ${preview.words.length} word${preview.words.length === 1 ? '' : 's'}${preview.format ? ` (${preview.format})` : ''}`
                : 'No words found yet'}
              {errors > 0 && ` · ${errors} row${errors === 1 ? '' : 's'} with problems`}
            </p>
          )}
        </li>
      </ol>
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => ensureValid() && submit.mutate()}
          disabled={!preview?.words.length || submit.isPending}
        >
          {submit.isPending ? 'Reading…' : 'Review words'}
        </Button>
      </div>
    </div>
  );
}
