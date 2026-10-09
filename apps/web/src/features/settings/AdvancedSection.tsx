import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpdateProfile } from '@/hooks/useProfile';
import { meQuery } from '@/lib/queries';
import { SettingsCard } from './SettingsCard';

export function AdvancedSection() {
  const { data: me } = useQuery(meQuery);
  const update = useUpdateProfile();
  if (!me) return null;
  const on = me.profile.advancedMode;

  return (
    <SettingsCard
      id="advanced"
      title="Advanced"
      description="Tools for finding out what went wrong."
    >
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => update.mutate({ advancedMode: e.target.checked })}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          <span className="font-medium">Advanced mode: record everything in the activity log</span>
          <span className="block text-muted-foreground">
            Every request to the server is recorded, with how long it took and what came back, next
            to every AI call (prompt and answer) and problems in the app, such as a broken
            connection or audio that didn’t play. Adds a Log link to the account menu. Problems are
            always recorded; entries are kept for 14 days.
          </span>
        </span>
      </label>
      <Button asChild variant="outline">
        <Link to="/log">
          <ScrollText /> Open the activity log
        </Link>
      </Button>
    </SettingsCard>
  );
}
