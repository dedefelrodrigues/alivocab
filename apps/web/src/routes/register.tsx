import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, INVITE_HEADER } from '@/lib/auth-client';
import { meQuery } from '@/lib/queries';

export const Route = createFileRoute('/register')({
  validateSearch: z.object({ invite: z.string().optional() }),
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: '/' });
  },
  component: RegisterPage,
});

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(80),
  email: z.email('Please enter a valid email'),
  password: z.string().min(8, 'At least 8 characters').max(128),
  invite: z.string().trim().min(4, 'An invite code is required'),
});

type Errors = Partial<Record<keyof z.infer<typeof registerSchema> | 'form', string>>;

function RegisterPage() {
  const { invite } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    const { name, email, password, invite: code } = parsed.data;
    setPending(true);
    setErrors({});
    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      fetchOptions: { headers: { [INVITE_HEADER]: code } },
    });
    setPending(false);
    if (error) {
      if (error.code === 'INVALID_INVITE') setErrors({ invite: error.message });
      else setErrors({ form: error.message ?? 'Sign-up failed' });
      return;
    }
    // Refetch now: the cached `null` (signed out) would otherwise bounce us back here.
    await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    await navigate({ to: '/', replace: true });
  };

  return (
    <AuthLayout
      title="Create your account"
      description="AliVocab is invite-only for now."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormField id="invite" label="Invite code" error={errors.invite}>
          <Input
            id="invite"
            name="invite"
            defaultValue={invite}
            autoCapitalize="characters"
            placeholder="ALI-XXXXXXXX"
            aria-invalid={!!errors.invite}
            autoFocus={!invite}
          />
        </FormField>
        <FormField id="name" label="Name" error={errors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            aria-invalid={!!errors.name}
            autoFocus={!!invite}
          />
        </FormField>
        <FormField id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
          />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={errors.password}
          hint="At least 8 characters."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
          />
        </FormField>
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
