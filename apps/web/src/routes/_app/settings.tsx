import { createFileRoute } from '@tanstack/react-router';
import { AccountSection } from '@/features/settings/AccountSection';
import { AiProvidersSection } from '@/features/settings/AiProvidersSection';
import { AppearanceSection } from '@/features/settings/AppearanceSection';
import { LearningSection } from '@/features/settings/LearningSection';
import { VoiceSection } from '@/features/settings/VoiceSection';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

const SECTIONS = [
  { id: 'learning', label: 'Learning' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'voice', label: 'Voice' },
  { id: 'ai', label: 'AI providers' },
  { id: 'account', label: 'Account' },
];

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <nav aria-label="Settings sections" className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-1">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded-full border px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>
      <LearningSection />
      <AppearanceSection />
      <VoiceSection />
      <AiProvidersSection />
      <AccountSection />
    </div>
  );
}
