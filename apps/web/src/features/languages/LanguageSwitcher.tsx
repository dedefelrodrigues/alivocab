import { languageName } from '@alivocab/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveLang, useLanguages, useSwitchLanguage } from '@/hooks/useLanguages';
import { AddLanguageDialog } from './AddLanguageDialog';

/** Header menu: the language being learned, switching to another one, adding one. */
export function LanguageSwitcher() {
  const active = useActiveLang();
  const languages = useLanguages().filter((l) => !l.archived);
  const { switchTo } = useSwitchLanguage();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-0.5 px-2 font-semibold"
            aria-label={`Learning ${languageName(active)}. Change language`}
            title={`Learning ${languageName(active)}`}
          >
            {active.toUpperCase()}
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Learning</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={active} onValueChange={switchTo}>
            {languages.map((l) => (
              <DropdownMenuRadioItem key={l.lang} value={l.lang}>
                {languageName(l.lang)}
                <span className="ml-auto text-xs text-muted-foreground">
                  {l.lang.toUpperCase()}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus /> Add a language
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings" hash="languages">
              <Settings2 /> Manage languages
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {adding && <AddLanguageDialog onClose={() => setAdding(false)} />}
    </>
  );
}
