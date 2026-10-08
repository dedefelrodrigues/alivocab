import type { PictureDto } from '@alivocab/shared';
import { cn } from '@/lib/utils';

/**
 * 40px square for list rows. Words without a picture show their first letter so rows stay
 * aligned; a pulsing tile means a picture is being looked up.
 */
export function WordThumb({
  image,
  lemma,
  pending,
  className,
}: {
  image: PictureDto | null;
  lemma: string;
  pending?: boolean;
  className?: string;
}) {
  const base = cn('size-10 shrink-0 overflow-hidden rounded-md', className);
  if (image) {
    return (
      <img
        src={image.thumbUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(base, 'object-cover')}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        base,
        'flex items-center justify-center bg-muted text-sm font-semibold uppercase text-muted-foreground',
        pending && 'motion-safe:animate-pulse',
      )}
    >
      {lemma.slice(0, 1)}
    </span>
  );
}
