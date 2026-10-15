import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { speak } from '@/hooks/useVoices';

export function SpeakButton({ text, lang }: { text: string; lang: string }) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Pronounce “${text}”`}
      onClick={(e) => {
        e.stopPropagation();
        speak(text, lang);
      }}
    >
      <Volume2 />
    </Button>
  );
}
