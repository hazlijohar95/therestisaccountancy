import { socialHref } from '../../lib/links.ts';

/** Social's not-found page, inside its layout. */
export function SocialNotFound() {
  return (
    <div className="page narrow">
      <div className="card empty">
        <h1 className="head">Not found.</h1>
        <p>The link may be old, or the page was taken down.</p>
        <a className="btn sm" href={socialHref('/')}>
          Back to the Floor
        </a>
      </div>
    </div>
  );
}
