import { languageName } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Bot, Plus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReviewSummaryCard } from '@/features/review/ReviewSummaryCard';
import { ThemeCard } from '@/features/themes/ThemeCard';
import { credentialsQuery, meQuery, themesQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

function HomePage() {
  const { data: me } = useQuery(meQuery);
  const { data: themes } = useQuery(themesQuery);
  const { data: credentials } = useQuery(credentialsQuery);
  if (!me) return null;
  const { profile } = me;
  const recent = themes?.slice(0, 4) ?? [];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">Cześć, {me.user.name}! 👋</h1>
        <p className="text-muted-foreground">
          Learning {languageName(profile.targetLang)} · translations in{' '}
          {languageName(profile.nativeLang)}
        </p>
      </section>

      <ReviewSummaryCard />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Your themes</h2>
          <div className="flex gap-2">
            {themes && themes.length > 4 && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/themes">See all {themes.length}</Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link to="/themes/new">
                <Plus /> New theme
              </Link>
            </Button>
          </div>
        </div>
        {recent.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {recent.map((t) => (
              <ThemeCard key={t.id} theme={t} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Create a theme to get your first word list.
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <Bot className="size-5 text-primary" />
            <CardTitle>AI providers</CardTitle>
            <CardDescription>
              {credentials?.length
                ? `${credentials.length} connected.`
                : 'None yet. Copy & paste works without one.'}
            </CardDescription>
            <div className="pt-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/settings" hash="ai">
                  <Settings /> Manage
                </Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
