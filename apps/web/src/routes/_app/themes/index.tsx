import { languageName } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeCard } from '@/features/themes/ThemeCard';
import { useActiveLang } from '@/hooks/useLanguages';
import { themesQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/themes/')({
  component: ThemesPage,
});

function ThemesPage() {
  const lang = useActiveLang();
  const { data: themes, isPending } = useQuery(themesQuery(lang));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Themes</h1>
          <p className="text-sm text-muted-foreground">{languageName(lang)}</p>
        </div>
        <Button asChild>
          <Link to="/themes/new">
            <Plus /> New theme
          </Link>
        </Button>
      </div>
      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : themes?.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} />
          ))}
        </div>
      ) : (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <BookOpen className="size-8 text-primary" />
          <p className="font-medium">No themes yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Pick a topic you care about, like “At the bakery” or “My job”, and get a list of words
            to learn.
          </p>
          <Button asChild>
            <Link to="/themes/new">
              <Plus /> Create your first theme
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
