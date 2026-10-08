import { languageName } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, Bot, Layers, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { credentialsQuery, meQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

function HomePage() {
  const { data: me } = useQuery(meQuery);
  const { data: credentials } = useQuery(credentialsQuery);
  if (!me) return null;
  const { profile } = me;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">Cześć, {me.user.name}! 👋</h1>
        <p className="text-muted-foreground">
          Learning {languageName(profile.targetLang)} · translations in{' '}
          {languageName(profile.nativeLang)}
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <BookOpen className="size-5 text-primary" />
            <CardTitle>Themes</CardTitle>
            <CardDescription>
              Create themed word sets with AI or a pasted list. Coming in the next phase.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Layers className="size-5 text-primary" />
            <CardTitle>Reviews</CardTitle>
            <CardDescription>Flashcards with spaced repetition. Coming soon.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="sm:col-span-2">
          <CardHeader>
            <Bot className="size-5 text-primary" />
            <CardTitle>AI providers</CardTitle>
            <CardDescription>
              {credentials?.length
                ? `${credentials.length} provider${credentials.length > 1 ? 's' : ''} connected.`
                : 'No API key added yet. You can always use the copy-prompt flow without one.'}
            </CardDescription>
            <div className="pt-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/settings" hash="ai">
                  <Settings /> Manage in settings
                </Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
