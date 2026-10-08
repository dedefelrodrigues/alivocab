import type { InviteDto } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage, unwrap } from '@/lib/api';
import { invitesQuery } from '@/lib/queries';

const STATUS_CLASS: Record<InviteDto['status'], string> = {
  active: 'text-correct',
  used: 'text-muted-foreground',
  expired: 'text-status-recognize',
  revoked: 'text-incorrect',
};

const inviteLink = (code: string) =>
  `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Could not copy; select and copy it manually');
  }
}

export function InvitesPanel() {
  const queryClient = useQueryClient();
  const { data: invites, isPending } = useQuery(invitesQuery);
  const [maxUses, setMaxUses] = useState('1');
  const [days, setDays] = useState('14');
  const [note, setNote] = useState('');
  const [created, setCreated] = useState<InviteDto | null>(null);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.admin.invites.$post({
          json: { maxUses: Number(maxUses), expiresInDays: days ? Number(days) : null, note },
        }),
      ),
    onSuccess: (invite) => {
      setNote('');
      setCreated(invite);
      void queryClient.invalidateQueries(invitesQuery);
      void copy(inviteLink(invite.code), 'Invite link');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.admin.invites[':id'].revoke.$post({ param: { id } })),
    onSuccess: () => void queryClient.invalidateQueries(invitesQuery),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New invite</CardTitle>
          <CardDescription>
            The sign-up link is copied to your clipboard when created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onSubmit}
            className="grid gap-4 sm:grid-cols-[6rem_8rem_1fr_auto] sm:items-end"
          >
            <FormField id="maxUses" label="Uses">
              <Input
                id="maxUses"
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </FormField>
            <FormField id="days" label="Expires (days)">
              <Input
                id="days"
                type="number"
                min={1}
                max={365}
                placeholder="never"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </FormField>
            <FormField id="note" label="Note">
              <Input
                id="note"
                maxLength={120}
                placeholder="Who is it for?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={create.isPending}>
              <Plus /> Create
            </Button>
          </form>
          {created && (
            <div className="mt-4 grid gap-1.5 rounded-lg border bg-muted/50 p-3">
              <label htmlFor="created-link" className="text-sm font-medium">
                Invite created: share this link
              </label>
              <div className="flex gap-2">
                <Input
                  id="created-link"
                  readOnly
                  value={inviteLink(created.code)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy invite link"
                  onClick={() => copy(inviteLink(created.code), 'Invite link')}
                >
                  <Copy />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="divide-y rounded-lg border">
          {invites?.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">No invites yet.</li>
          )}
          {invites?.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono font-medium">{inv.code}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {inv.uses}/{inv.maxUses} used
                  {inv.expiresAt && ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                  {inv.note && ` · ${inv.note}`}
                </p>
              </div>
              <Badge variant="outline" className={STATUS_CLASS[inv.status]}>
                {inv.status}
              </Badge>
              {inv.status === 'active' && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(inviteLink(inv.code), 'Invite link')}
                  >
                    <Copy /> Link
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(inv.id)}>
                    <Ban /> Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
