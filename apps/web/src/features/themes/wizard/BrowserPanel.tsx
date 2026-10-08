import { BATCH_SEPARATOR, buildVocabPrompt, parseVocabulary } from '@alivocab/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Cpu, Download, Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type BrowserEngine,
  type BrowserEngineId,
  chromeAvailability,
  hasWebGpu,
  loadEngine,
  WEBLLM_MODELS,
} from '@/features/browser-ai/engines';
import { api, errorMessage, unwrap } from '@/lib/api';
import { meQuery, themeQuery } from '@/lib/queries';
import type { SourceProps } from './types';

/** Small models stay reliable with short lists, so generate in batches of this size. */
const BATCH = 10;

type Support = { chrome: Awaited<ReturnType<typeof chromeAvailability>>; webgpu: boolean };

export function BrowserPanel({ setup, ensureValid, onProposal }: SourceProps) {
  const { data: me } = useQuery(meQuery);
  const { data: theme } = useQuery({
    ...themeQuery(setup.themeId ?? ''),
    enabled: !!setup.themeId,
  });
  const [support, setSupport] = useState<Support | null>(null);
  const [engineId, setEngineId] = useState<BrowserEngineId>(`webllm:${WEBLLM_MODELS[0].id}`);
  const [progress, setProgress] = useState<{ fraction: number | null; text: string } | null>(null);
  const engine = useRef<BrowserEngine | null>(null);

  useEffect(() => {
    void Promise.all([chromeAvailability(), hasWebGpu()]).then(([chrome, webgpu]) => {
      setSupport({ chrome, webgpu });
      if (!webgpu && chrome !== 'unavailable') setEngineId('chrome');
    });
    return () => {
      void engine.current?.dispose();
    };
  }, []);

  const run = useMutation({
    mutationFn: async () => {
      if (!me) throw new Error('Not signed in');
      const lang = theme?.targetLang ?? me.profile.targetLang;
      const nativeLang = theme?.nativeLang ?? me.profile.nativeLang;

      if (engine.current?.id !== engineId) {
        await engine.current?.dispose();
        engine.current = null;
        setProgress({ fraction: 0, text: 'Loading model…' });
        engine.current = await loadEngine(engineId, setProgress);
      }

      // The server knows which words the theme already has.
      const { avoid: themeAvoid } = await unwrap(
        api.generate.prompt.$post({
          json: {
            themeName: setup.themeName,
            themeId: setup.themeId,
            count: setup.count,
            level: setup.level,
          },
        }),
      );
      const avoid = [...themeAvoid];
      const outputs: string[] = [];
      let found = 0;
      const rounds = Math.ceil(setup.count / BATCH) + 1;
      for (let round = 0; round < rounds && found < setup.count; round++) {
        const count = Math.min(BATCH, setup.count - found);
        setProgress({
          fraction: found / setup.count,
          text: `Generating words ${found + 1}–${found + count} of ${setup.count}…`,
        });
        const prompt = buildVocabPrompt({
          targetLang: lang,
          nativeLang,
          themeName: setup.themeName,
          description: setup.description || undefined,
          count,
          level: setup.level,
          format: 'json',
          avoid,
        });
        const text = await engine.current.generate(prompt);
        outputs.push(text.trim());
        const parsed = parseVocabulary(text, { lang, nativeLang });
        const fresh = parsed.words.filter((w) => !avoid.includes(w.lemma));
        if (!fresh.length) break;
        avoid.push(...fresh.map((w) => w.lemma));
        found += fresh.length;
      }
      setProgress(null);
      return unwrap(
        api.generate.import.$post({
          json: {
            raw: outputs.join(BATCH_SEPARATOR),
            source: 'browser',
            model: engineId,
            themeName: setup.themeName,
            themeId: setup.themeId,
          },
        }),
      );
    },
    onSuccess: onProposal,
    onError: (err) => {
      setProgress(null);
      toast.error(errorMessage(err), { duration: 8000 });
    },
  });

  if (!support)
    return <p className="text-sm text-muted-foreground">Checking what this device supports…</p>;

  const chromeUsable = support.chrome !== 'unavailable';
  if (!support.webgpu && !chromeUsable) {
    return (
      <Alert>
        <TriangleAlert />
        <AlertDescription>
          This browser can’t run AI models locally (it needs WebGPU, e.g. a recent Chrome, Edge or
          Safari on a capable device). Use copy &amp; paste or an API key instead.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      <Alert>
        <TriangleAlert />
        <AlertDescription>
          Experimental: small on-device models make more grammar mistakes, so check genders and
          forms when reviewing. The first run downloads the model (cached for next time); nothing
          leaves your device.
        </AlertDescription>
      </Alert>
      <FormField id="engine" label="Model">
        <Select
          value={engineId}
          onValueChange={(v) => setEngineId(v as BrowserEngineId)}
          disabled={run.isPending}
        >
          <SelectTrigger id="engine" className="w-full sm:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {support.webgpu &&
              WEBLLM_MODELS.map((m) => (
                <SelectItem key={m.id} value={`webllm:${m.id}`}>
                  {m.label} · {m.size}
                  {m.note && <span className="text-muted-foreground"> · {m.note}</span>}
                </SelectItem>
              ))}
            {chromeUsable && (
              <SelectItem value="chrome">
                Chrome built-in (Gemini Nano)
                {support.chrome === 'available' ? '' : ' · downloads on first use'}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </FormField>

      {progress && (
        <div role="status" className="grid gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round((progress.fraction ?? 0) * 100)}%` }}
            />
          </div>
          <p className="truncate text-xs text-muted-foreground">{progress.text}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => ensureValid() && run.mutate()}
          disabled={run.isPending}
        >
          {run.isPending ? (
            <Loader2 className="animate-spin" />
          ) : engine.current?.id === engineId ? (
            <Cpu />
          ) : (
            <Download />
          )}
          {engine.current?.id === engineId
            ? `Generate ${setup.count} words`
            : `Load model & generate`}
        </Button>
      </div>
    </div>
  );
}
