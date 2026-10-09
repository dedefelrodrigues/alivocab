import { describe, expect, it } from 'vitest';
import { findPageImage, unwrapImageLink } from './links.ts';

describe('unwrapImageLink', () => {
  it('extracts the image from Google Images result links', () => {
    const img = 'https://cdn.example.org/fruit/orange.jpg';
    expect(
      unwrapImageLink(
        `https://www.google.com/imgres?imgurl=${encodeURIComponent(img)}&imgrefurl=https%3A%2F%2Fexample.org%2Fpage&tbnid=x`,
      ),
    ).toBe(img);
    expect(
      unwrapImageLink(`https://www.google.pl/url?sa=i&url=${encodeURIComponent(img)}&psig=abc`),
    ).toBe(img);
  });

  it('extracts the image from Bing and DuckDuckGo links', () => {
    const img = 'https://cdn.example.org/a b.png';
    expect(
      unwrapImageLink(
        `https://www.bing.com/images/search?view=detailV2&mediaurl=${encodeURIComponent(img)}&q=x`,
      ),
    ).toBe(img);
    expect(
      unwrapImageLink(
        `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(img)}&f=1`,
      ),
    ).toBe(img);
  });

  it('leaves other links alone', () => {
    expect(unwrapImageLink('  https://example.org/photo.jpg ')).toBe(
      'https://example.org/photo.jpg',
    );
    expect(unwrapImageLink('https://www.google.com/search?q=orange')).toBe(
      'https://www.google.com/search?q=orange',
    );
    // A wrapped value that isn't a web address is ignored.
    expect(unwrapImageLink('https://www.google.com/imgres?imgurl=javascript:alert(1)')).toBe(
      'https://www.google.com/imgres?imgurl=javascript:alert(1)',
    );
  });
});

describe('findPageImage', () => {
  it('prefers og:image and resolves relative addresses', () => {
    const html = `<html><head>
      <meta name="twitter:image" content="https://example.org/tw.jpg">
      <meta property="og:image" content="/img/main.jpg?w=1200&amp;h=630" />
    </head></html>`;
    expect(findPageImage(html, 'https://example.org/fruit/orange')).toBe(
      'https://example.org/img/main.jpg?w=1200&h=630',
    );
  });

  it('falls back to twitter:image and image_src', () => {
    expect(
      findPageImage(`<meta content='https://x.org/t.png' name='twitter:image'>`, 'https://x.org/'),
    ).toBe('https://x.org/t.png');
    expect(findPageImage('<link rel="image_src" href="//cdn.x.org/i.png">', 'https://x.org/')).toBe(
      'https://cdn.x.org/i.png',
    );
  });

  it('returns null without a usable image', () => {
    expect(findPageImage('<title>Nothing</title>', 'https://x.org/')).toBeNull();
    expect(
      findPageImage('<meta property="og:image" content="javascript:alert(1)">', 'https://x.org/'),
    ).toBeNull();
  });
});
