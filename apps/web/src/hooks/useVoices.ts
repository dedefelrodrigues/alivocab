import { useEffect, useState } from 'react';
import { speak as speakWith } from '@/lib/speech';

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Browser TTS voices for a language (ISO 639-1), updated when the voice list loads. */
export function useVoices(lang: string): { supported: boolean; voices: SpeechSynthesisVoice[] } {
  const [all, setAll] = useState<SpeechSynthesisVoice[]>(() =>
    supported ? window.speechSynthesis.getVoices() : [],
  );

  useEffect(() => {
    if (!supported) return;
    const update = () => setAll(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  const voices = all
    .filter((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === lang)
    .sort(
      (a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name),
    );

  return { supported, voices };
}

/** Speaks with the learner's chosen provider (see `@/lib/speech`). */
export function speak(text: string, lang: string, voice?: string | null) {
  void speakWith(text, lang, { voice });
}

/** Short sample phrases for the "Test voice" button. */
export const VOICE_SAMPLES: Record<string, string> = {
  pl: 'Dzień dobry! Uczę się polskiego. Gżegżółka, źdźbło, szczęście.',
  en: 'Hello! I am learning new words every day.',
  pt: 'Olá! Estou a aprender palavras novas todos os dias.',
  es: '¡Hola! Estoy aprendiendo palabras nuevas cada día.',
  fr: 'Bonjour ! J’apprends de nouveaux mots chaque jour.',
  de: 'Hallo! Ich lerne jeden Tag neue Wörter.',
  it: 'Ciao! Imparo parole nuove ogni giorno.',
  uk: 'Привіт! Я щодня вивчаю нові слова.',
};
