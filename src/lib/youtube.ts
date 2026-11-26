/* A YouTube video's ID from any of its usual addresses: watch?v=, youtu.be/, /embed/, /shorts/ and /live/. */

const ID = /^[\w-]{11}$/;

export function youtubeId(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const [first, second] = url.pathname.split('/').filter(Boolean);
  const id =
    host === 'youtu.be' ? first
    : host === 'youtube.com' || host === 'youtube-nocookie.com' ? (first === 'watch' ? url.searchParams.get('v') ?? undefined : ['embed', 'shorts', 'live'].includes(first ?? '') ? second : undefined)
    : undefined;
  return id && ID.test(id) ? id : undefined;
}

/** The player that sets no cookies until the visitor plays it. */
export const embedAddress = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
