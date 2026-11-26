import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Decision } from '../../../../src/server/listings.ts';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { ListingEntry } from '../../components/club/ListingEntry.tsx';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
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
    { id: 'waiting', title: 'Waiting for a check', items: data.waiting, open: true, empty: 'Nothing waiting. New and changed listings appear here, oldest first.' },
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
      <Masthead label="Admin · Directory" title={data.title}>
        <p>
          A check answers two questions. Is this person a member? Is the practice real and theirs: the name, the town, the website? You are not vouching for their work, and the
          directory says so. Approve it and it goes up. Return it with a note and the member gets your note by email.
        </p>
      </Masthead>

      {shown}

      {groups.map((group) => (
        <section className={`wrap ${s.block}`} aria-labelledby={`${group.id}-title`} key={group.id}>
          <h2 className="head" id={`${group.id}-title`}>
            {group.title}
          </h2>
          {group.items.length === 0 ? (
            <p className={s.empty}>{group.empty}</p>
          ) : (
            <ol className={s.checks}>
              {group.items.map((l) => {
                const member = l.listing.memberId;
                const retrying = noteError?.member === member;
                const note = wireField(retrying ? noteError.message : undefined, { id: `note-${member}-error`, hint: `note-${member}-hint` });
                return (
                  <li className={s.check} key={member}>
                    <p className={`small ${s.who}`}>
                      <Link to="/admin/members/$id" params={{ id: String(member) }}>
                        {l.listing.name}
                      </Link>{' '}
                      · {l.email} · {l.standing}
                      {l.href && (
                        <>
                          {' '}
                          · <a href={l.href}>See it in the directory</a>
                        </>
                      )}
                    </p>
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
                          <form method="POST" className="field" onSubmit={(event) => void onReturn(event, member, l.seen)}>
                            <label htmlFor={`note-${member}`}>What needs to change</label>
                            <textarea
                              className="input"
                              id={`note-${member}`}
                              name="note"
                              rows={3}
                              required
                              maxLength={data.noteMax}
                              {...note.input}
                            />
                            <span className="hint" id={`note-${member}-hint`}>
                              The member gets this by email, word for word.
                            </span>
                            <FieldError field={note} className={s.error} />
                            <button className="btn ghost" type="submit" disabled={busy}>
                              {l.review.state === 'listed' ? 'Take it down' : 'Return it'}
                            </button>
                          </form>
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ))}
    </>
  );
}
