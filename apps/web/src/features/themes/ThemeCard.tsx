import type { ThemeSummaryDto } from '@alivocab/shared';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBar } from './status';

export function ThemeCard({ theme }: { theme: ThemeSummaryDto }) {
  return (
    <Link
      to="/themes/$themeId"
      params={{ themeId: theme.id }}
      className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardHeader>
          <CardTitle className="truncate">{theme.name}</CardTitle>
          <CardDescription>
            {theme.wordCount} word{theme.wordCount === 1 ? '' : 's'}
            {theme.description && ` · ${theme.description}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatusBar counts={theme.counts} />
        </CardContent>
      </Card>
    </Link>
  );
}
