import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, KeyRound, ShieldCheck, ShieldOff, UserCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth-client';
import { meQuery, usersQuery } from '@/lib/queries';

type AdminAction =
  | { type: 'ban' | 'unban'; userId: string }
  | { type: 'role'; userId: string; role: 'admin' | 'user' }
  | { type: 'password'; userId: string; newPassword: string };

async function runAction(action: AdminAction) {
  const { error } = await (() => {
    switch (action.type) {
      case 'ban':
        return authClient.admin.banUser({ userId: action.userId, banReason: 'Disabled by admin' });
      case 'unban':
        return authClient.admin.unbanUser({ userId: action.userId });
      case 'role':
        return authClient.admin.setRole({ userId: action.userId, role: action.role });
      case 'password':
        return authClient.admin.setUserPassword({
          userId: action.userId,
          newPassword: action.newPassword,
        });
    }
  })();
  if (error) throw new Error(error.message ?? 'Action failed');
}

export function UsersPanel() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: users, isPending } = useQuery(usersQuery);
  const [passwordFor, setPasswordFor] = useState<{ id: string; name: string } | null>(null);

  const action = useMutation({
    mutationFn: runAction,
    onSuccess: (_r, a) => {
      toast.success(
        a.type === 'password' ? 'Password set. Share it with the user securely.' : 'Updated',
      );
      void queryClient.invalidateQueries(usersQuery);
    },
    onError: (err) => toast.error(err.message),
  });

  if (isPending) return <Skeleton className="h-24 w-full" />;

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {users?.map((u) => {
          const self = u.id === me?.user.id;
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {u.name} {self && <span className="text-muted-foreground">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {u.email} · joined {new Date(u.createdAt).toLocaleDateString()}
                </p>
              </div>
              {u.role === 'admin' && <Badge variant="secondary">admin</Badge>}
              {u.banned && (
                <Badge variant="outline" className="text-incorrect">
                  disabled
                </Badge>
              )}
              {!self && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPasswordFor({ id: u.id, name: u.name })}
                  >
                    <KeyRound /> Password
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      action.mutate({
                        type: 'role',
                        userId: u.id,
                        role: u.role === 'admin' ? 'user' : 'admin',
                      })
                    }
                  >
                    {u.role === 'admin' ? <ShieldOff /> : <ShieldCheck />}
                    {u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      action.mutate({ type: u.banned ? 'unban' : 'ban', userId: u.id })
                    }
                  >
                    {u.banned ? <UserCheck /> : <Ban />}
                    {u.banned ? 'Enable' : 'Disable'}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {passwordFor && (
        <SetPasswordDialog
          name={passwordFor.name}
          pending={action.isPending}
          onClose={() => setPasswordFor(null)}
          onSubmit={(newPassword) =>
            action.mutate(
              { type: 'password', userId: passwordFor.id, newPassword },
              { onSuccess: () => setPasswordFor(null) },
            )
          }
        />
      )}
    </>
  );
}

function SetPasswordDialog({
  name,
  pending,
  onClose,
  onSubmit,
}: {
  name: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const tooShort = password.length > 0 && password.length < 8;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length >= 8) onSubmit(password);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a new password for {name}</DialogTitle>
          <DialogDescription>
            Use this when someone is locked out. They can change it in Settings afterwards.
          </DialogDescription>
        </DialogHeader>
        <form id="set-password" onSubmit={submit}>
          <FormField
            id="newUserPassword"
            label="New password"
            error={tooShort ? 'At least 8 characters' : null}
          >
            <Input
              id="newUserPassword"
              type="text"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="set-password" disabled={pending || password.length < 8}>
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
