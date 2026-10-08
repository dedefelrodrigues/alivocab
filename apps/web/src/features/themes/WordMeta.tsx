import { GENDER_LABELS, type Gender, type PartOfSpeech, POS_LABELS } from '@alivocab/shared';

/** "noun · m" style grammar line. */
export function WordMeta({
  pos,
  gender,
  aspect,
  aspectPair,
}: {
  pos: PartOfSpeech;
  gender?: Gender | null;
  aspect?: 'impf' | 'pf' | null;
  aspectPair?: string | null;
}) {
  const parts = [
    POS_LABELS[pos],
    gender && (
      <abbr key="g" title={GENDER_LABELS[gender]} className="no-underline">
        {gender}
      </abbr>
    ),
    aspect && (
      <abbr
        key="a"
        title={aspect === 'pf' ? 'perfective' : 'imperfective'}
        className="no-underline"
      >
        {aspect}
      </abbr>
    ),
    aspectPair && <span key="p">↔ {aspectPair}</span>,
  ].filter(Boolean);
  return (
    <span className="text-xs text-muted-foreground">
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable list
        <span key={i}>
          {i > 0 && ' · '}
          {p}
        </span>
      ))}
    </span>
  );
}
