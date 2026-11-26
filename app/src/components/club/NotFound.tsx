import { Page } from './Page.tsx';
import { PageHead } from './PageHead.tsx';

/** The club's 404. */
export function NotFound() {
  return (
    <Page>
      <PageHead label="404" title="That page is not in the ledger." lead="The link may be old, or mistyped.">
        <a className="btn" href="/">
          Go home
        </a>
        <a className="btn ghost" href="/programmes">
          See the programmes
        </a>
      </PageHead>
    </Page>
  );
}
