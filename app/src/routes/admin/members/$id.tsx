import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { capitalised } from '../../../../../src/lib/format.ts';
import { LinkNotice } from '../../../components/admin/LinkNotice.tsx';
import { FieldError } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Check, Field, Form } from '../../../components/ui/Form.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Points } from '../../../components/ui/Points.tsx';
import { Actions, Section } from '../../../components/ui/Section.tsx';
import { adminMember, issueLink, reinstateMember, removeMember, suspendMember, updateMember } from '../../../functions/admin-members.ts';
import { failureOf } from '../../../lib/outcome.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './$id.module.css';

export const Route = createFileRoute('/admin/members/$id')({
  loader: ({ params }) => adminMember({ data: { id: params.id } }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.member.name) }),
  component: AdminMember,
});

const access = {
  invited: 'No password set yet. A new invitation link replaces any earlier one.',
  active: 'They can sign in. A reset link lets them choose a new password and signs them out everywhere else.',
  suspended: 'They cannot sign in or use a link, and their sessions have ended. Reinstating lets them sign in with their existing password.',
} as const;

function AdminMember() {
  const { member, self, roles, facts } = Route.useLoaderData();
  const navigate = useNavigate();
  const update = useAction(updateMember, { refresh: 'always' });
  const newLink = useAction(issueLink, { refresh: 'always' });
  const suspend = useAction(suspendMember, { refresh: 'always' });
  const reinstate = useAction(reinstateMember, { refresh: 'always' });
  const remove = useAction(removeMember, { refresh: 'always' });
  const busy = [update, newLink, suspend, reinstate, remove].some((x) => x.busy);
  const [shown, setShown] = useState<ReactNode>(null);
  const name = update.field('name');
  const email = update.field('email', { hint: 'email-hint' });
  const confirmed = remove.field('confirm');

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = form.get('role');
    const outcome = await update.run({ member: member.id, name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''), ...(role === 'member' || role === 'admin' ? { role } : {}) });
    if (!outcome) return;
    if (!outcome.ok) return setShown(failureOf(outcome) && <Notice tone="error">{outcome.message}</Notice>);
    setShown(<Notice>Saved.</Notice>);
  };

  const onLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await newLink.run({ member: member.id });
    if (!outcome) return;
    setShown(outcome.ok ? <LinkNotice issued={outcome.value} /> : <Notice tone="error">{outcome.message}</Notice>);
  };

  const onSuspend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await suspend.run({ member: member.id });
    if (!outcome) return;
    setShown(outcome.ok ? <Notice>Suspended. They are signed out everywhere.</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  const onReinstate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await reinstate.run({ member: member.id });
    if (!outcome) return;
    setShown(outcome.ok ? <Notice>Reinstated. They can sign in with their password.</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  const onRemove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirm = String(new FormData(event.currentTarget).get('confirm') ?? '');
    const outcome = await remove.run({ member: member.id, confirm });
    if (!outcome) return;
    if (!outcome.ok) return setShown(failureOf(outcome) && <Notice tone="error">{outcome.message}</Notice>);
    await navigate({ to: '/admin', search: { removed: true } });
  };

  return (
    <>
      <PageHead
        label="Admin / Member"
        title={member.name}
        actions={
          <Link className="btn ghost" to="/admin" hash="members-title">
            All members
          </Link>
        }
      />

      {shown}

      <Section title="On record">
        <dl className={`facts ${s.facts}`}>
          {facts.map(({ term, detail }) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Details">
        <Form onSubmit={onSave} key={`${member.name} ${member.email} ${member.role}`}>
          <Field label="Name" id="name" field={name}>
            <input className="input" id="name" name="name" defaultValue={member.name} maxLength={60} required {...name.input} />
          </Field>
          <Field label="Email" id="email" hint="They sign in with this. Tell them when it changes." field={email}>
            <input className="input" id="email" name="email" type="email" defaultValue={member.email} required {...email.input} />
          </Field>
          {self ? (
            <p className={`small ${s.note}`}>You are an admin. Another admin can change your role.</p>
          ) : (
            <Field label="Role" id="role" hint="Admins can invite, edit, suspend and remove members, and moderate the community.">
              <select className="input" id="role" name="role" defaultValue={member.role}>
                {roles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <button className="btn" type="submit" disabled={busy}>
            Save
          </button>
        </Form>
      </Section>

      <Section title="Access" meta={<Badge tone={member.status === 'suspended' ? 'solid' : 'plain'}>{capitalised(member.status)}</Badge>}>
        <p className={s.note}>{access[member.status]}</p>
        <Actions>
          {member.status !== 'suspended' && (
            <form method="POST" onSubmit={onLink}>
              <button className="btn" type="submit" disabled={busy}>
                {member.status === 'invited' ? 'New invitation link' : 'Reset link'}
              </button>
            </form>
          )}
          {member.status === 'suspended' ? (
            <form method="POST" onSubmit={onReinstate}>
              <button className="btn" type="submit" disabled={busy}>
                Reinstate
              </button>
            </form>
          ) : (
            !self && (
              <form method="POST" onSubmit={onSuspend}>
                <button className="btn ghost" type="submit" disabled={busy}>
                  Suspend
                </button>
              </form>
            )
          )}
        </Actions>
      </Section>

      {!self && (
        <Section title="Remove">
          <Points
            items={[
              { icon: 'alert', text: 'Deletes their account, lesson progress, open links and join request' },
              { icon: 'users', text: "Their community posts and replies go too, and so do other members' replies under their posts" },
              { icon: 'lock', text: 'Cannot be undone. To keep their record, suspend them instead.' },
            ]}
          />
          <Form onSubmit={onRemove}>
            <div className="field">
              <Check name="confirm" value="yes" required {...confirmed.input} label={`I understand ${member.name} will be deleted for good.`} />
              <FieldError field={confirmed} />
            </div>
            <button className="btn" type="submit" disabled={busy}>
              Remove member
            </button>
          </Form>
        </Section>
      )}
    </>
  );
}
