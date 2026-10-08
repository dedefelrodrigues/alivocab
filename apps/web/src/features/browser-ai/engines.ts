/**
 * In-browser text generation: Chrome's built-in model (Prompt API / Gemini Nano) and WebLLM
 * (open models on WebGPU). Both run fully on the device; output goes through the same import
 * endpoint as pasted text. WebLLM is loaded lazily because the library is large.
 */

export type BrowserEngineId = 'chrome' | `webllm:${string}`;

export type ProgressFn = (p: { fraction: number | null; text: string }) => void;

export type BrowserEngine = {
  id: BrowserEngineId;
  generate: (prompt: string, signal?: AbortSignal) => Promise<string>;
  dispose: () => Promise<void>;
};

export const WEBLLM_MODELS = [
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B',
    size: '≈2 GB',
    note: 'Best balance',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen 3 4B',
    size: '≈2.5 GB',
    note: 'Best quality, needs more GPU memory',
  },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', size: '≈2 GB', note: '' },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B',
    size: '≈1 GB',
    note: 'Fastest, lower quality',
  },
] as const;

// ── Chrome built-in AI (Prompt API) ─────────────────────────────────────────

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type ChromeSession = {
  prompt: (text: string, opts?: { signal?: AbortSignal }) => Promise<string>;
  destroy: () => void;
};
type ChromeLanguageModel = {
  availability: (opts?: unknown) => Promise<Availability>;
  create: (opts?: {
    monitor?: (m: EventTarget) => void;
    expectedOutputs?: Array<{ type: 'text'; languages: string[] }>;
  }) => Promise<ChromeSession>;
};

function chromeApi(): ChromeLanguageModel | undefined {
  return (globalThis as { LanguageModel?: ChromeLanguageModel }).LanguageModel;
}

export async function chromeAvailability(): Promise<Availability> {
  try {
    return (await chromeApi()?.availability()) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function loadChrome(onProgress: ProgressFn): Promise<BrowserEngine> {
  const api = chromeApi();
  if (!api) throw new Error('Chrome built-in AI is not available in this browser');
  const session = await api.create({
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    monitor: (m) =>
      m.addEventListener('downloadprogress', (e) => {
        const loaded = (e as Event & { loaded?: number }).loaded ?? 0;
        onProgress({
          fraction: loaded,
          text: `Downloading Gemini Nano… ${Math.round(loaded * 100)}%`,
        });
      }),
  });
  return {
    id: 'chrome',
    generate: (prompt, signal) => session.prompt(prompt, { signal }),
    dispose: async () => session.destroy(),
  };
}

// ── WebLLM ──────────────────────────────────────────────────────────────────

export async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function loadWebLlm(modelId: string, onProgress: ProgressFn): Promise<BrowserEngine> {
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  const engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (r) => onProgress({ fraction: r.progress, text: r.text }),
  });
  return {
    id: `webllm:${modelId}`,
    generate: async (prompt) => {
      const reply = await engine.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'Follow the requested output format exactly and output nothing else.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 3000,
        // Qwen3: answer directly instead of emitting a long <think> block.
        extra_body: { enable_thinking: false },
      });
      return reply.choices[0]?.message.content ?? '';
    },
    dispose: () => engine.unload(),
  };
}

export function loadEngine(id: BrowserEngineId, onProgress: ProgressFn): Promise<BrowserEngine> {
  return id === 'chrome'
    ? loadChrome(onProgress)
    : loadWebLlm(id.slice('webllm:'.length), onProgress);
}
