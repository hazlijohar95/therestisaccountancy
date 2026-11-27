import { useState } from 'react';
import type { LinkPurpose } from '../../../../src/server/club.ts';
import type { Issued } from '../../functions/admin.server.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Points } from '../ui/Points.tsx';
import s from './LinkNotice.module.css';

const what = { welcome: 'Invitation', reset: 'Reset link' } as const satisfies Record<LinkPurpose, string>;

interface Point {
  readonly icon: IconName;
  readonly text: string;
}

const signsOut: Point = { icon: 'repeat', text: 'Setting a new password with it signs them out everywhere else' };

/** A link an admin just issued: whether it was emailed, and the link itself, shown this once, to copy and send by hand. */
export function LinkNotice({ issued }: { issued: Issued }) {
  const { name, email, purpose, link, expires, emailed } = issued;
  const [copied, setCopied] = useState(false);
  const points: readonly Point[] = [
    { icon: 'clock', text: `Expires ${expires}` },
    { icon: 'lock', text: emailed ? 'Shown only this once, in case the email does not arrive' : 'Shown only this once' },
    ...(purpose === 'reset' ? [signsOut] : []),
  ];
  return (
    <section className={`wrap ${s.notice}`} aria-live="polite">
      <p className={emailed ? s.head : `${s.head} ${s.alert}`}>
        <Icon name={emailed ? 'mail' : 'alert'} />
        {emailed ? `${what[purpose]} emailed to ${name} at ${email}.` : `${what[purpose]} ready for ${name}, but the email did not send. Copy the link and send it yourself.`}
      </p>
      <Points items={points} />
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
