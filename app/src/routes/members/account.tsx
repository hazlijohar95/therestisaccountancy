import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { anyTerm, joiningRate, STOP_NOTE_MAX, STOP_REASONS, stopReasonLabel, TERMS, terms } from '../../../../src/data/membership.ts';
import { formatDay } from '../../../../src/lib/format.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Check, Choices, Field, Form } from '../../components/ui/Form.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Actions, Section } from '../../components/ui/Section.tsx';
import { Stats, type StatItem } from '../../components/ui/Stat.tsx';
import { useAction } from '../../components/useAction.ts';
import { changePassword, membersAccount, setEmailPrefs } from '../../functions/members-account.ts';
import { setRenews } from '../../functions/members-billing.ts';
import { formText } from '../../lib/form.ts';
import { clubTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/members/account')({
  loader: () => membersAccount(),
  head: () => ({ meta: clubTitle('Account') }),
  component: Account,
});

function Account() {
  const { member, standing, prefs, minPassword: MIN_PASSWORD_LENGTH } = Route.useLoaderData();
  const renews = useAction(setRenews, { refresh: 'always' });
  const prefsForm = useAction(setEmailPrefs, { refresh: 'never' });
  const passwordForm = useAction(changePassword, { refresh: 'never' });
  const [renewal, setRenewal] = useState<{ renews: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [changed, setChanged] = useState(false);
  const stopNote = renews.field('note');
  const newPassword = passwordForm.field('password', { hint: 'password-hint' });
  const confirm = passwordForm.field('confirm');

  const until = standing?.paidUntil ? formatDay(standing.paidUntil) : null;
  /* A card renews at the term of the last paid checkout, so paying for the other term is how a member changes it. */
  const renewsByCard = standing !== null && standing.cardOnFile && standing.renews && standing.access === 'paid';
  const status = !standing ? null : standing.access === 'paid' ? <Badge tone="solid">Active</Badge> : standing.access === 'grace' ? <Badge tone="live">Payment due</Badge> : <Badge>{until ? 'Ended' : 'Not started'}</Badge>;
  const figures: StatItem[] =
    !standing || !until
      ? []
      : [
          { label: standing.access === 'unpaid' ? `Last ${standing.term} ended` : 'Paid until', value: until },
          { label: 'Plan', value: terms[standing.term].price, note: `a ${standing.term}` },
          ...(standing.access === 'unpaid'
            ? []
            : [
                {
                  label: 'Renewal',
                  value: standing.renews ? 'On' : 'Off',
                  note: !standing.renews
                    ? `Membership ends ${until}`
                    : standing.cardOnFile
                      ? `Card charged ${terms[standing.term].price} on ${until} for the next ${standing.term}`
                      : `We email a link to pay for the next ${standing.term} a few days before ${until}`,
                },
              ]),
        ];
  const choices = [
    { name: 'replies', label: 'Replies to what I post in the community', hint: 'At most one email per post every six hours.', on: prefs.replies },
    { name: 'digest', label: 'A weekly email on Mondays', hint: 'New posts and coming sessions, only when there is news. Off unless you turn it on.', on: prefs.digest },
  ] as const;

  const toggleRenewal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!standing) return;
    const form = new FormData(event.currentTarget);
    const reason = STOP_REASONS.find((r) => r === form.get('reason'));
    const note = formText(form, 'note');
    const outcome = await renews.run(standing.renews ? { renews: false, ...(reason && { reason }), ...(note && { note }) } : { renews: true });
    if (!outcome) return;
    setRenewal(outcome.ok ? outcome.value : null);
  };
  const savePrefs = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = await prefsForm.run({ replies: form.has('replies'), digest: form.has('digest') });
    if (!outcome) return;
    setSaved(outcome.ok);
  };
  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const outcome = await passwordForm.run({ current: formText(form, 'current'), password: formText(form, 'password'), confirm: formText(form, 'confirm') });
    if (!outcome) return;
    setChanged(outcome.ok);
    if (outcome.ok) element.reset();
  };

  return (
    <>
      <PageHead label="Account" title={member.name} lead={member.email} />

      <Section title="Your details">
        <Stats
          items={[
            { label: 'Member number', value: member.number },
            { label: 'Member since', value: formatDay(member.joinedAt) },
          ]}
        />
        <p className="small">To change your name or email, ask the club.</p>
      </Section>

      {standing && (
        <Section title="Membership" id="membership" meta={status}>
          {figures.length > 0 ? <Stats items={figures} /> : <p>{joiningRate}</p>}
          {standing.access === 'grace' && (
            <Notice tone="error" inline>
              Your paid {standing.term} has ended. Pay within a few days to keep your access.
            </Notice>
          )}
          {!renewsByCard && (
            <Actions>
              <a className="btn" href="/members/pay">
                Pay for {anyTerm}
              </a>
            </Actions>
          )}
          {renewsByCard && (
            <Points
              items={[
                {
                  icon: 'repeat',
                  text: (
                    <>
                      To switch between the {TERMS.join(' and the ')}, <a href="/members/pay">pay for the other now</a>. It starts after {until}, and your card renews at that rate.
                    </>
                  ),
                },
              ]}
            />
          )}
          {standing.access !== 'unpaid' && (
            <Form onSubmit={toggleRenewal}>
              {standing.renews && (
                <>
                  <Choices legend="Why are you stopping? (optional)">
                    {STOP_REASONS.map((reason) => (
                      <Check key={reason} type="radio" name="reason" value={reason} label={stopReasonLabel[reason]} />
                    ))}
                  </Choices>
                  <Field label="Anything we should know? (optional)" id="stop-note" field={stopNote}>
                    <textarea className="input" id="stop-note" name="note" rows={3} maxLength={STOP_NOTE_MAX} {...stopNote.input} />
                  </Field>
                </>
              )}
              {renewal && (
                <Notice inline>{renewal.renews ? 'Renewal is on.' : `Renewal is off. You keep access until ${until}.`}</Notice>
              )}
              <button className={standing.renews ? 'btn ghost' : 'btn'} type="submit">
                {standing.renews ? 'Turn off renewal' : 'Turn renewal back on'}
              </button>
            </Form>
          )}
        </Section>
      )}

      <Section title="Emails from the club" id="email">
        <p className="small">Invitations, password links and emails about sessions you said you would come to always arrive.</p>
        <Form onSubmit={savePrefs}>
          {choices.map((c) => (
            <Check key={c.name} name={c.name} defaultChecked={c.on} label={c.label} hint={c.hint} />
          ))}
          {saved && <Notice inline>Saved.</Notice>}
          {prefsForm.refusal && (
            <Notice tone="error" inline>
              {prefsForm.refusal.message}
            </Notice>
          )}
          <button className="btn" type="submit">
            Save
          </button>
        </Form>
      </Section>

      <Section title="Password">
        <p className="small">Changing it signs you out on every other device.</p>
        <Form onSubmit={savePassword}>
          <input type="hidden" name="email" value={member.email} autoComplete="username" />
          <Field label="Current password" id="current">
            <input className="input" id="current" name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" id="password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} field={newPassword}>
            <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required {...newPassword.input} />
          </Field>
          <Field label="The new password again" id="confirm" field={confirm}>
            <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" required {...confirm.input} />
          </Field>
          {passwordForm.failure && (
            <Notice tone="error" inline>
              {passwordForm.failure}
            </Notice>
          )}
          {changed && <Notice inline>Password changed. Anywhere else you were signed in is now signed out.</Notice>}
          <button className="btn" type="submit">
            Change password
          </button>
        </Form>
      </Section>
    </>
  );
}
