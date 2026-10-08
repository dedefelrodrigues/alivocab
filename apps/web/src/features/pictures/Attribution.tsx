import type { PictureDto } from '@alivocab/shared';

const PROVIDER_LABEL = {
  wikimedia: 'Wikimedia Commons',
  openverse: 'Openverse',
  pexels: 'Pexels',
  upload: 'your upload',
} as const;

/** Credit line required by the licenses (creator, license, source). */
export function Attribution({ image }: { image: PictureDto }) {
  if (image.provider === 'upload') return <span>Your picture</span>;
  const link = 'underline-offset-2 hover:underline';
  return (
    <span>
      {image.creator &&
        (image.creatorUrl ? (
          <a href={image.creatorUrl} target="_blank" rel="noreferrer" className={link}>
            {image.creator}
          </a>
        ) : (
          image.creator
        ))}
      {image.license && (
        <>
          {image.creator && ' · '}
          {image.licenseUrl ? (
            <a href={image.licenseUrl} target="_blank" rel="noreferrer" className={link}>
              {image.license}
            </a>
          ) : (
            image.license
          )}
        </>
      )}
      {' · '}
      {image.sourceUrl ? (
        <a href={image.sourceUrl} target="_blank" rel="noreferrer" className={link}>
          via {PROVIDER_LABEL[image.provider]}
        </a>
      ) : (
        `via ${PROVIDER_LABEL[image.provider]}`
      )}
    </span>
  );
}
