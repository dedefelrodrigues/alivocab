import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { PictureDto } from '@alivocab/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { toPictureDto } from './service.ts';

const { userLexemes, lexemes, lexemeImages } = schema;

export type ResolvedPicture = { image: PictureDto | null; hidden: boolean };

/** The picture each word shows for this user: hidden → none, personal choice → shared default. */
export function resolvePictures(
  db: Db,
  userId: string,
  lexemeIds: string[],
): Map<string, ResolvedPicture> {
  const out = new Map<string, ResolvedPicture>();
  if (!lexemeIds.length) return out;
  const rows = db
    .select({
      lexemeId: lexemes.id,
      defaultId: lexemes.imageId,
      ownId: userLexemes.imageId,
      hidden: userLexemes.imageHidden,
    })
    .from(lexemes)
    .leftJoin(
      userLexemes,
      and(eq(userLexemes.lexemeId, lexemes.id), eq(userLexemes.userId, userId)),
    )
    .where(inArray(lexemes.id, lexemeIds))
    .all();
  const imageIds = [
    ...new Set(rows.flatMap((r) => [r.ownId, r.defaultId]).filter((x): x is string => !!x)),
  ];
  const images = new Map(
    imageIds.length
      ? db
          .select()
          .from(lexemeImages)
          .where(inArray(lexemeImages.id, imageIds))
          .all()
          .map((img) => [img.id, img] as const)
      : [],
  );
  for (const r of rows) {
    const hidden = r.hidden ?? false;
    const row =
      (r.ownId && images.get(r.ownId)) || (r.defaultId && images.get(r.defaultId)) || null;
    out.set(r.lexemeId, { hidden, image: !hidden && row ? toPictureDto(row) : null });
  }
  return out;
}
