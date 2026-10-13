import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ModelInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Model ids loaded from the provider; when present, a picker button appears. */
  models: readonly string[];
  placeholder?: string;
  className?: string;
};

/**
 * Free-text model id with a pick list. `<datalist>` alone is not enough: iOS Safari never shows
 * it as a dropdown, so the list also sits in a native `<select>` (the iOS wheel picker) hidden
 * behind the chevron button. Typing stays possible for ids the provider doesn't list.
 */
export function ModelInput({
  id,
  value,
  onChange,
  models,
  placeholder,
  className,
}: ModelInputProps) {
  const listId = useId();
  const hasModels = models.length > 0;

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        list={hasModels ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={hasModels ? 'pr-11' : undefined}
      />
      {hasModels && (
        <>
          <datalist id={listId}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <select
            aria-label="Choose from the available models"
            value={models.includes(value) ? value : ''}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="peer absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
          >
            <option value="" disabled>
              Choose a model…
            </option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-sm border-l text-muted-foreground peer-hover:bg-accent peer-hover:text-accent-foreground peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50"
          >
            <ChevronDown className="size-4" />
          </span>
        </>
      )}
    </div>
  );
}
