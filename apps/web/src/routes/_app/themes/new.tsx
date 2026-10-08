import type { ProposalDto } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ReviewStep } from '@/features/themes/wizard/ReviewStep';
import { SetupCard, validateSetup } from '@/features/themes/wizard/SetupCard';
import { SourceCard } from '@/features/themes/wizard/SourceCard';
import type { ThemeSetup } from '@/features/themes/wizard/types';
import { meQuery, themeQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/themes/new')({
  validateSearch: z.object({ themeId: z.string().optional() }),
  component: NewThemePage,
});

function NewThemePage() {
  const { themeId } = Route.useSearch();
  const { data: me } = useQuery(meQuery);
  const { data: theme } = useQuery({ ...themeQuery(themeId ?? ''), enabled: !!themeId });

  const [setup, setSetup] = useState<ThemeSetup>({
    themeName: '',
    description: '',
    count: me?.profile.defaultWordCount ?? 30,
    level: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ThemeSetup, string>>>({});
  const [proposal, setProposal] = useState<ProposalDto | null>(null);
  const [pastedRaw, setPastedRaw] = useState<string | null>(null);

  // When extending a theme, its name/description drive the prompt.
  const effective: ThemeSetup = theme
    ? { ...setup, themeId: theme.id, themeName: theme.name, description: theme.description ?? '' }
    : setup;

  const ensureValid = () => {
    const found = validateSetup(effective);
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  if (proposal) {
    return (
      <ReviewStep
        setup={effective}
        proposal={proposal}
        onBack={(raw) => {
          setPastedRaw(raw);
          setProposal(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to={theme ? '/themes/$themeId' : '/themes'} params={{ themeId: theme?.id ?? '' }}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {theme ? `Add words to “${theme.name}”` : 'New theme'}
        </h1>
      </div>
      <SetupCard value={effective} onChange={setSetup} errors={errors} locked={!!theme} />
      <SourceCard
        setup={effective}
        ensureValid={ensureValid}
        onProposal={setProposal}
        initialRaw={pastedRaw}
      />
    </div>
  );
}
