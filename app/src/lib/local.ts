/** The machine's own addresses, Social's included (social.localhost and the like), where local-only routes answer. */
export const isLocalHost = (url: string) => {
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname.endsWith('.localhost');
};
