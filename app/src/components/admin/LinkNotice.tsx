import { useState } from 'react';
import type { LinkPurpose } from '../../../../src/server/club.ts';
import type { Issued } from '../../functions/admin.server.ts';
import s from './LinkNotice.module.css';

const what = { welcome: 'Invitation', reset: 'Reset link' } as const satisfies Record<LinkPurpose, string>;

/** A link an admin just issued: whether it was emailed, and the link itself, shown this once, to copy and send by hand. */
export function LinkNotice({ issued }: { issued: Issued }) {
  const { name, email, purpose, link, expires, emailed } = issued;
  const [copied, setCopied] = useState(false);
  return (
    <section className={`wrap ${s.notice}`} aria-live="polite">
      <p>
        {emailed ? (
          <b>
            {what[purpose]} emailed to {name} at {email}.
          </b>
        ) : (
          <b className={s.alert}>{what[purpose]} ready for {name}, but the email did not send. Copy the link and send it yourself.</b>
        )}
        {purpose === 'reset' && ' Setting a new password with it signs them out everywhere else.'} It expires on {expires}. The link is shown only this once
        {emailed ? ', in case the email does not arrive.' : '.'}
      </p>
      <div className={s.copy}>
        <input className="input" id="issued-link" readOnly value={link} aria-label={what[purpose]} />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </section>
  );
}
