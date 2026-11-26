import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { anyTerm, everyRate, TERMS, terms } from '../../../../src/data/membership.ts';
import { formatDay } from '../../../../src/lib/format.ts';
import { MIN_PASSWORD_LENGTH } from '../../../../src/server/password.ts';
import { Masthead } from '../../components/members/Masthead.tsx';
import { changePassword, membersAccount, setEmailPrefs } from '../../functions/members-account.ts';
import { setRenews } from '../../functions/members-billing.ts';
import type { Outcome } from '../../lib/outcome.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './account.module.css';

export const Route = createFileRoute('/members/account')({
  loader: () => membersAccount(),
  head: () => ({ meta: clubTitle('Account') }),
  component: Account,
});

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

function Account() {
  const { member, standing, prefs } = Route.useLoaderData();
  const router = useRouter();
  const sendRenews = useServerFn(setRenews);
  const sendPrefs = useServerFn(setEmailPrefs);
  const sendPassword = useServerFn(changePassword);
  const [renewal, setRenewal] = useState<Outcome<{ renews: boolean }> | null>(null);
  const [saved, setSaved] = useState<Outcome<unknown> | null>(null);
  const [password, setPassword] = useState<Outcome<null> | null>(null);

  const until = standing?.paidUntil ? formatDay(standing.paidUntil) : null;
  const plan = !standing
    ? null
    : !until
      ? `Not started. Membership is ${everyRate}.`
      : standing.access === 'unpaid'
        ? `Your last paid ${standing.term} ended on ${until}.`
        : !standing.renews
          ? `Paid until ${until}. Renewal is off, so your membership ends then.`
          : standing.cardOnFile
            ? `Paid until ${until}. Your card is then charged ${terms[standing.term].price} for the next ${standing.term}.`
            : `${terms[standing.term].label}. Paid until ${until}. We email you a link to pay for the next ${standing.term} a few days before.`;
  /* A card renews at the term of the last paid checkout, so paying for the other term is how a member changes it. */
  const renewsByCard = standing !== null && standing.cardOnFile && standing.renews && standing.access === 'paid';
  const choices = [
    { name: 'replies', label: 'Replies in threads I posted in', hint: 'At most one email per thread every six hours.', on: prefs.replies },
    { name: 'digest', label: 'A weekly email on Mondays', hint: 'New threads and the sessions coming up. Off unless you turn it on; only sent when there is news.', on: prefs.digest },
  ] as const;
  const details = [
    { term: 'Name', detail: member.name },
    { term: 'Email', detail: member.email },
    { term: 'Member number', detail: member.number },
    { term: 'Member since', detail: formatDay(member.joinedAt) },
  ];
  const fieldErrors = password && !password.ok ? password.fields : {};
  const passwordError = password && !password.ok && Object.keys(password.fields).length === 0 ? password.message : null;

  const toggleRenewal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!standing) return;
    const outcome = await sendRenews({ data: { renews: !standing.renews } });
    setRenewal(outcome);
    await router.invalidate();
  };
  const savePrefs = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(await sendPrefs({ data: { replies: form.has('replies'), digest: form.has('digest') } }));
  };
  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const outcome = await sendPassword({ data: { current: text(form, 'current'), password: text(form, 'password'), confirm: text(form, 'confirm') } });
    setPassword(outcome);
    if (outcome.ok) element.reset();
  };

  return (
    <>
      <Masthead label="Account" title={member.name} />
      <section className={`wrap ${s.block}`} aria-labelledby="details-title">
        <h2 className="head" id="details-title">
          Your details
        </h2>
        <dl className="facts">
          {details.map(({ term, detail }) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        <p className="small">To change your name or email, ask the club.</p>
      </section>
      {standing && (
        <section className={`wrap ${s.block}`} id="membership" aria-labelledby="membership-title">
          <h2 className="head" id="membership-title">
            Membership
          </h2>
          <p>{plan}</p>
          {standing.access === 'grace' && (
            <p className={s.error} role="alert">
              Your paid {standing.term} has ended. Pay within a few days to keep your access.
            </p>
          )}
          <div className={s.row}>
            {!renewsByCard && (
              <a className="btn" href="/members/pay">
                Pay for {anyTerm}
              </a>
            )}
            {standing.access !== 'unpaid' && (
              <form method="POST" onSubmit={toggleRenewal}>
                <button className={standing.renews ? 'btn ghost' : 'btn'} type="submit">
                  {standing.renews ? 'Turn off renewal' : 'Turn renewal back on'}
                </button>
              </form>
            )}
          </div>
          {renewal?.ok && (
            <p className={s.ok} role="status">
              {renewal.value.renews ? 'Renewal is on.' : `Renewal is off. You keep access until ${until}.`}
            </p>
          )}
          {renewsByCard && (
            <p className="small">
              To change between paying by the {TERMS.join(' and the ')}, <a href="/members/pay">pay for the other now</a>. It is added after {until}, and your card renews at that rate from then on.
            </p>
          )}
        </section>
      )}
      <section className={`wrap ${s.block}`} id="email" aria-labelledby="email-title">
        <h2 className="head" id="email-title">
          Emails from the club
        </h2>
        <p className="small">Invitations, password links and emails about sessions you said you would come to always arrive.</p>
        <form method="POST" className={s.form} onSubmit={savePrefs}>
          {choices.map((c) => (
            <label key={c.name} className={s.check}>
              <input type="checkbox" name={c.name} defaultChecked={c.on} />
              <span>
                <b>{c.label}</b>
                <span className="hint">{c.hint}</span>
              </span>
            </label>
          ))}
          {saved?.ok && (
            <p className={s.ok} role="status">
              Saved.
            </p>
          )}
          {saved && !saved.ok && (
            <p className={s.error} role="alert">
              {saved.message}
            </p>
          )}
          <button className="btn" type="submit">
            Save email choices
          </button>
        </form>
      </section>
      <section className={`wrap ${s.block}`} aria-labelledby="password-title">
        <h2 className="head" id="password-title">
          Change your password
        </h2>
        <p className="small">Changing it signs you out on every other device.</p>
        <form method="POST" className={s.form} onSubmit={savePassword}>
          <input type="hidden" name="email" value={member.email} autoComplete="username" />
          <div className="field">
            <label htmlFor="current">Current password</label>
            <input className="input" id="current" name="current" type="password" autoComplete="current-password" required />
          </div>
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              aria-invalid={fieldErrors['password'] ? true : undefined}
              aria-describedby={fieldErrors['password'] ? 'password-hint password-error' : 'password-hint'}
            />
            <span className="hint" id="password-hint">
              At least {MIN_PASSWORD_LENGTH} characters.
            </span>
            {fieldErrors['password'] && (
              <span className={s.error} id="password-error">
                {fieldErrors['password']}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="confirm">The new password again</label>
            <input
              className="input"
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={fieldErrors['confirm'] ? true : undefined}
              aria-describedby={fieldErrors['confirm'] ? 'confirm-error' : undefined}
            />
            {fieldErrors['confirm'] && (
              <span className={s.error} id="confirm-error">
                {fieldErrors['confirm']}
              </span>
            )}
          </div>
          {passwordError && (
            <p className={s.error} role="alert">
              {passwordError}
            </p>
          )}
          {password?.ok && (
            <p className={s.ok} role="status">
              Your password has been changed. Anywhere else you were signed in is now signed out.
            </p>
          )}
          <button className="btn" type="submit">
            Change password
          </button>
        </form>
      </section>
    </>
  );
}
