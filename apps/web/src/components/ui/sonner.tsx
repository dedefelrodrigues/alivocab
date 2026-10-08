import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useAppearance } from '@/appearance/AppearanceProvider';

/** shadcn Toaster, wired to AliVocab's appearance provider instead of next-themes. */
const Toaster = (props: ToasterProps) => {
  const { resolvedMode } = useAppearance();

  return (
    <Sonner
      theme={resolvedMode}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-correct" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-status-recognize" />,
        error: <OctagonXIcon className="size-4 text-incorrect" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
