import type { ColorMode } from '@alivocab/shared/appearance';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { BookOpen, Home, Layers, LogOut, Monitor, Moon, Settings, Shield, Sun } from 'lucide-react';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUpdateProfile } from '@/hooks/useProfile';
import { authClient } from '@/lib/auth-client';
import { meQuery, reviewSummaryQuery } from '@/lib/queries';

const NEXT_MODE: Record<ColorMode, ColorMode> = { system: 'light', light: 'dark', dark: 'system' };
const MODE_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

const navLinkClass =
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&.active]:bg-secondary [&.active]:text-secondary-foreground';

export function AppHeader() {
  const { data: me } = useQuery(meQuery);
  const { data: summary } = useQuery(reviewSummaryQuery);
  const pending = (summary?.dueNow ?? 0) + (summary?.newAvailable ?? 0);
  const { mode } = useAppearance();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ModeIcon = MODE_ICON[mode];

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: '/login' });
  };

  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-4">
        <Link to="/" className="mr-2 text-lg font-bold tracking-tight">
          Ali<span className="text-primary">Vocab</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1" aria-label="Main">
          <Link to="/" className={navLinkClass} activeOptions={{ exact: true }}>
            <Home className="size-4" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <Link to="/review" className={navLinkClass} search={{}}>
            <Layers className="size-4" />
            <span className="hidden sm:inline">Review</span>
            {pending > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
                {pending > 99 ? '99+' : pending}
                <span className="sr-only"> cards to review</span>
              </span>
            )}
          </Link>
          <Link to="/themes" className={navLinkClass}>
            <BookOpen className="size-4" />
            <span className="hidden sm:inline">Themes</span>
          </Link>
          <Link to="/settings" className={navLinkClass}>
            <Settings className="size-4" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
          {me?.user.role === 'admin' && (
            <Link to="/admin" className={navLinkClass}>
              <Shield className="size-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
        </nav>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Color mode: ${mode}. Switch to ${NEXT_MODE[mode]}`}
          title={`Color mode: ${mode}`}
          onClick={() => updateProfile.mutate({ colorMode: NEXT_MODE[mode] })}
        >
          <ModeIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {me?.user.name.slice(0, 1).toUpperCase() ?? '?'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="font-medium">{me?.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me?.user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
