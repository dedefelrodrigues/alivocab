import { LANGUAGES } from '@alivocab/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A language picker over the offered languages, minus any in `exclude`. */
export function LanguageSelect({
  id,
  value,
  onChange,
  exclude = [],
  placeholder,
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  exclude?: readonly string[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.filter((l) => !exclude.includes(l.code)).map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.name}
            {l.nativeName !== l.name && (
              <span className="text-muted-foreground"> · {l.nativeName}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
