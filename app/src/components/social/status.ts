import { createIsomorphicFn } from '@tanstack/react-start';
import { setResponseStatus } from '@tanstack/react-start/server';

/** Sets the page's HTTP status while it renders on the server. A navigation in the browser has none to set. */
export const pageStatus = createIsomorphicFn()
  .server((code: number) => setResponseStatus(code))
  .client(() => undefined);
