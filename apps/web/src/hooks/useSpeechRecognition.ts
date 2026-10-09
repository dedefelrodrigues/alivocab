import { useCallback, useEffect, useRef, useState } from 'react';

/** The parts of the Web Speech recognition API we use (not in TypeScript's DOM types). */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** BCP 47 tags for recognition, which needs a region (e.g. "pl" → "pl-PL"). */
const REGION: Record<string, string> = {
  pl: 'pl-PL',
  en: 'en-US',
  pt: 'pt-PT',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  uk: 'uk-UA',
  nl: 'nl-NL',
  cs: 'cs-CZ',
  sv: 'sv-SE',
  ro: 'ro-RO',
};

/**
 * Dictation with the browser's speech recognition (Chrome, Edge, Safari). `onText` receives the
 * text heard so far while listening.
 */
export function useSpeechRecognition(lang: string, onText: (text: string) => void) {
  const supported = !!recognitionCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    recognition.current?.abort();
    const r = new Ctor();
    r.lang = REGION[lang] ?? lang;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i]?.[0]?.transcript ?? '';
      handler.current(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      setError(
        e.error === 'not-allowed'
          ? 'Microphone access was blocked. Allow it in the browser to speak your answer.'
          : e.error === 'no-speech'
            ? null
            : `Speech recognition failed (${e.error}).`,
      );
    };
    recognition.current = r;
    setError(null);
    setListening(true);
    r.start();
  }, [lang]);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, error, start, stop };
}
