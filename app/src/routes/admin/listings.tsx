import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Decision } from '../../../../src/server/listings.ts';
import { useAction } from '../../components/useAction.ts';
import { ListingEntry } from '../../components/club/ListingEntry.tsx';
import { Empty } from '../../components/ui/Empty.tsx';
import { Field, Form } from '../../components/ui/Form.tsx';
import { List, Meta, Row } from '../../components/ui/List.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { adminListings, approveListing, returnListing } from '../../functions/admin-listings.ts';
import { wireField } from '../../lib/form.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './listings.module.css';

export const Route = createFileRoute('/admin/listings')({
  loader: () => adminListings(),
  head: () => ({ meta: clubTitle('Directory · Admin') }),
  component: Listings,
});

const doneNotice: Record<Decision, string> = {
  listed: 'Approved. It is in the directory, and the member has been emailed.',
  paused: 'Approved. The member has it paused, so it shows once they unpause it. They have been emailed.',
  hidden: 'Approved. It stays out of the directory while the membership is unpaid or suspended. The member has been emailed.',
  returned: 'Returned. The member has your note by email.',
};

/** A note that was refused: which listing it was for, and why. */
interface NoteError {
  readonly member: number;
  readonly message: string;
}

function Listings() {
  const data = Route.useLoaderData();
  const approve = useAction(approveListing, { refresh: 'always' });
  const sendBack = useAction(returnListing, { refresh: 'always' });
  const busy = approve.busy || sendBack.busy;
  const [shown, setShown] = useState<ReactNode>(null);
  const [noteError, setNoteError] = useState<NoteError | null>(null);
  const groups = [
    { id: 'waiting', title: 'Waiting for a check', items: data.waiting, open: true, empty: 'Nothing waiting. New and changed listings land here, oldest first.' },
    { id: 'rest', title: 'Everything else', items: data.rest, open: false, empty: 'No other listings yet.' },
  ];

  const onApprove = async (member: number, seen: string) => {
    const outcome = await approve.run({ member, seen });
    if (!outcome) return;
    setNoteError(null);
    setShown(outcome.ok ? <Notice>{doneNotice[outcome.value]}</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  const onReturn = async (event: FormEvent<HTMLFormElement>, member: number, seen: string) => {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '');
    const outcome = await sendBack.run({ member, seen, note });
    if (!outcome) return;
    const fieldError = outcome.ok ? undefined : outcome.fields['note'];
    setNoteError(fieldError ? { member, message: fieldError } : null);
    setShown(outcome.ok ? <Notice>{doneNotice[outcome.value]}</Notice> : fieldError ? null : <Notice tone="error">{outcome.message}</Notice>);
  };

  return (
    <>
      <PageHead label="Admin · Directory" title={data.title} lead="Approve a listing and it goes up. Return it with a note and the member gets the note by email." />

      {shown}

      <Section title="What a check asks">
        <Points
          items={[
            { icon: 'users', text: 'Is this person a member?' },
            { icon: 'check', text: 'Are the practice, town and website real and theirs?' },
            { icon: 'info', text: 'You are not vouching for their work. The directory says so.' },
          ]}
        />
      </Section>

      {groups.map((group) => (
        <Section title={group.title} key={group.id}>
          {group.items.length === 0 ? (
            <Empty icon="file">{group.empty}</Empty>
          ) : (
            <List ordered>
              {group.items.map((l) => {
                const member = l.listing.memberId;
                const retrying = noteError?.member === member;
                const note = wireField(retrying ? noteError.message : undefined, { id: `note-${member}-error`, hint: `note-${member}-hint` });
                return (
                  <Row
                    key={member}
                    title={
                      <Link to="/admin/members/$id" params={{ id: String(member) }}>
                        {l.listing.name}
                      </Link>
                    }
                    meta={
                      <>
                        <Meta icon="mail">{l.email}</Meta>
                        <span>{l.standing}</span>
                        {l.href && <a href={l.href}>See it in the directory</a>}
                      </>
                    }
                  >
                    {l.review.state === 'returned' && <blockquote className={s.note}>{l.review.note}</blockquote>}
                    {group.open ? (
                      <ListingEntry listing={l.listing} />
                    ) : (
                      <details className={s.read}>
                        <summary>
                          <span className={`serif ${s.practice}`}>{l.listing.practice}</span>{' '}
                          <span className="small">
                            {l.listing.town}, {l.listing.state}
                          </span>
                        </summary>
                        <ListingEntry listing={l.listing} />
                      </details>
                    )}
                    <div className={s.decide}>
                      {l.review.state !== 'listed' && (
                        <form
                          method="POST"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void onApprove(member, l.seen);
                          }}
                        >
                          <button className="btn" type="submit" disabled={busy}>
                            Approve
                          </button>
                        </form>
                      )}
                      {l.review.state !== 'returned' && (
                        <details className={s.sendBack} open={retrying || undefined}>
                          <summary>{l.review.state === 'listed' ? 'Take it down with a note' : 'Return with a note'}</summary>
                          <Form onSubmit={(event) => void onReturn(event, member, l.seen)}>
                            <Field label="What needs to change" id={`note-${member}`} hint="The member gets this by email, word for word." field={note}>
                              <textarea className="input" id={`note-${member}`} name="note" rows={3} required maxLength={data.noteMax} {...note.input} />
                            </Field>
                            <button className="btn ghost" type="submit" disabled={busy}>
                              {l.review.state === 'listed' ? 'Take it down' : 'Return it'}
                            </button>
                          </Form>
                        </details>
                      )}
                    </div>
                  </Row>
                );
              })}
            </List>
          )}
        </Section>
      ))}
    </>
  );
}
