import { PageHead } from '../ui/PageHead.tsx';
import { Page } from './Page.tsx';

/** The club's 404. */
export function NotFound() {
  return (
    <Page>
      <PageHead
        label="404"
        title="That page is not in the ledger."
        lead="The link may be old, or mistyped."
        actions={
          <>
            <a className="btn" href="/">
              Go home
            </a>
            <a className="btn ghost" href="/programmes">
              See the programmes
            </a>
          </>
        }
      />
    </Page>
  );
}
