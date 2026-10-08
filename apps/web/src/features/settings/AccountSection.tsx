import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { authClient } from '@/lib/auth-client';
import { meQuery } from '@/lib/queries';
import { SettingsCard } from './SettingsCard';

export function AccountSection() {
  const { data: me } = useQuery(meQuery);
  const queryClient = useQueryClient();
  const [nameError, setNameError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pending, setPending] = useState<'name' | 'password' | null>(null);
  if (!me) return null;

  const saveName = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return setNameError('Name cannot be empty');
    setPending('name');
    const { error } = await authClient.updateUser({ name });
    setPending(null);
    if (error) return setNameError(error.message ?? 'Could not save');
    setNameError(null);
    await queryClient.invalidateQueries(meQuery);
    toast.success('Name updated');
  };

  const changePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const currentPassword = String(form.get('currentPassword'));
    const newPassword = String(form.get('newPassword'));
    if (newPassword.length < 8) return setPwError('New password needs at least 8 characters');
    if (newPassword !== String(form.get('confirmPassword')))
      return setPwError('Passwords do not match');
    setPending('password');
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(null);
    if (error) return setPwError(error.message ?? 'Could not change password');
    setPwError(null);
    formEl.reset();
    toast.success('Password changed. Other devices were signed out.');
  };

  return (
    <SettingsCard id="account" title="Account" description={me.user.email}>
      <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <FormField id="name" label="Display name" error={nameError}>
            <Input id="name" name="name" defaultValue={me.user.name} autoComplete="name" />
          </FormField>
        </div>
        <Button type="submit" variant="outline" disabled={pending === 'name'}>
          Save name
        </Button>
      </form>

      <Separator />

      <form onSubmit={changePassword} className="grid gap-4">
        <p className="text-sm font-medium">Change password</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="currentPassword" label="Current">
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
          </FormField>
          <FormField id="newPassword" label="New">
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
            />
          </FormField>
          <FormField id="confirmPassword" label="Repeat new">
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
          </FormField>
        </div>
        {pwError && (
          <p role="alert" className="text-sm text-destructive">
            {pwError}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={pending === 'password'}>
            Change password
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
