import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { meQuery } from '@/lib/queries';
import { safeRedirect } from '@/lib/redirect';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
      rememberMe: true,
    });
    setPending(false);
    if (error) {
      setError(error.message ?? 'Sign-in failed');
      return;
    }
    // Refetch now: the cached `null` (signed out) would otherwise bounce us back here.
    await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    await navigate({ href: safeRedirect(search.redirect), replace: true });
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back! Witaj ponownie!"
      footer={
        <>
          Have an invite code?{' '}
          <Link
            to="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormField id="email" label="Email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </FormField>
        <FormField id="password" label="Password" error={error}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={!!error}
          />
        </FormField>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
