import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AREAS, BANDS, CASEBOOK_LIMITS, EMPLOYER_KINDS, ENGAGEMENT_ROLES, FRAMEWORKS, INDUSTRIES, ROLE_LIMITS, SERVICES } from '../../../../../src/data/social.ts';
import { identifying } from '../../../../../src/lib/guard.ts';
import { SocialLink } from '../../../components/social/SocialLink.tsx';
import { Tick } from '../../../components/social/Tick.tsx';
import { useAction } from '../../../components/social/useAction.ts';
import { addEntry, addRole, casebookPage, removeEntry, removeRole } from '../../../functions/social-casebook.ts';
import { socialSignInHref } from '../../../lib/links.ts';
import { noindex, socialTitle } from '../../../lib/title.ts';

const COSIGN_LINE = { pending: 'Waiting on', signed: 'Co-signed by', declined: 'Declined by' } as const;
const DONE = {
  added: 'Added to your casebook.',
  'entry-removed': 'Entry removed.',
  'role-added': 'Role added to your timeline.',
  'role-removed': 'Role removed.',
} as const;
type Done = keyof typeof DONE;

export const Route = createFileRoute('/social/casebook/new')({
  beforeLoad: ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/casebook/new') });
  },
  loader: () => casebookPage(),
  head: () => ({ meta: [...socialTitle('Casebook'), noindex] }),
  component: Casebook,
});

type Data = Awaited<ReturnType<typeof casebookPage>>;
type Select = 'service' | 'industry' | 'band' | 'framework' | 'year' | 'role';
type Draft = Record<Select | 'note' | 'cosigner', string> & { areas: string[] };

/** The entry as the form holds it now, for the preview and the guard. */
const draftOf = (form: HTMLFormElement): Draft => {
  const data = new FormData(form);
  const one = (name: string) => String(data.get(name) ?? '');
  return {
    service: one('service'),
    industry: one('industry'),
    band: one('band'),
    framework: one('framework'),
    year: one('year'),
    role: one('role'),
    areas: data.getAll('areas').map(String),
    note: one('note'),
    cosigner: one('cosigner'),
  };
};

function Casebook() {
  const data = Route.useLoaderData();
  const [done, setDone] = useState<Done | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const finished = (note: Done) => {
    setFailure(null);
    setDone(note);
  };
  const refused = (message: string | null) => {
    setDone(null);
    setFailure(message);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="kicker">Casebook</p>
          <h1 className="title">Log the work, not the client.</h1>
          <p className="lead">Bands and years only. A colleague with the seal co-signs it.</p>
        </div>
      </div>
      {!data.hasProfile ? (
        <div className="card empty">
          <p className="head">Claim your handle first.</p>
          <p>Your casebook shows on your profile.</p>
          <SocialLink className="btn sm" path="/edit">
            Claim your handle
          </SocialLink>
        </div>
      ) : (
        <>
          {done && (
            <p className="note" role="status">
              {DONE[done]}
            </p>
          )}
          {failure && (
            <p className="error" role="alert">
              {failure}
            </p>
          )}
          <EntryForm years={data.years} onDone={() => finished('added')} onRefused={refused} />

          <section className="section card" id="entries" aria-labelledby="entries-title">
            <header>
              <h2 className="head" id="entries-title">
                Your entries
              </h2>
              <SocialLink className="small" path="/me#casebook">
                See your heatmap
              </SocialLink>
            </header>
            {data.entries.length ? (
              <ul className="saved-list">
                {data.entries.map((entry) => (
                  <li key={entry.id}>
                    <svg className="ic" aria-hidden="true">
                      <use href="#i-file" />
                    </svg>
                    <span>
                      <b>
                        {entry.service} · {entry.industry}
                      </b>
                      <br />
                      {entry.band} · {entry.year} · {entry.role}
                      {entry.cosign && entry.cosigner && ` · ${COSIGN_LINE[entry.cosign]} ${entry.cosigner.name}`}
                    </span>
                    <RemoveEntry entry={entry} onDone={() => finished('entry-removed')} onRefused={refused} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small">No entries yet. Your first one starts your heatmap.</p>
            )}
          </section>

          <section className="section card" id="roles" aria-labelledby="roles-title">
            <header>
              <h2 className="head" id="roles-title">
                Your roles
              </h2>
              <span className="small">The kind of employer, never its name.</span>
            </header>
            {data.roles.length > 0 && (
              <ul className="saved-list">
                {data.roles.map((role) => (
                  <li key={role.id}>
                    <svg className="ic" aria-hidden="true">
                      <use href="#i-list" />
                    </svg>
                    <span>
                      <b>{role.title}</b> · {role.employer}
                      <br />
                      {role.from} to {role.to ?? 'now'}
                    </span>
                    <RemoveRole role={role} onDone={() => finished('role-removed')} onRefused={refused} />
                  </li>
                ))}
              </ul>
            )}
            <RoleForm thisYear={Number(data.years[0]) + 1} onDone={() => finished('role-added')} onRefused={refused} />
          </section>
        </>
      )}
    </div>
  );
}

function EntryForm({ years, onDone, onRefused }: { years: string[]; onDone: () => void; onRefused: (message: string | null) => void }) {
  const add = useAction(addEntry);
  const blank: Draft = {
    service: SERVICES[0],
    industry: INDUSTRIES[0],
    band: BANDS[0],
    framework: FRAMEWORKS[0],
    year: years[0] ?? '',
    role: ENGAGEMENT_ROLES[0],
    areas: [],
    note: '',
    cosigner: '',
  };
  const [draft, setDraft] = useState<Draft>(blank);
  const warnings = identifying(draft.note);
  const cosigner = draft.cosigner.trim().replace(/^@/, '');
  const selects: readonly { name: Select; label: string; options: readonly string[]; hint?: string }[] = [
    { name: 'service', label: 'Type of work', options: SERVICES },
    { name: 'industry', label: 'Industry', options: INDUSTRIES },
    { name: 'band', label: 'Size band', options: BANDS },
    { name: 'framework', label: 'Framework', options: FRAMEWORKS },
    { name: 'year', label: 'Year it ended', options: years, hint: 'Ended a year ago or more.' },
    { name: 'role', label: 'Your role', options: ENGAGEMENT_ROLES },
  ];

  const follow = (event: FormEvent<HTMLFormElement>) => setDraft(draftOf(event.currentTarget));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await add.run(draftOf(form));
    if (!outcome.ok) return onRefused(Object.keys(outcome.fields).length ? null : outcome.message);
    form.reset();
    setDraft(blank);
    onDone();
  };

  return (
    <div className="form-grid">
      <form className="panel card" method="POST" ref={add.form} onSubmit={submit} onInput={follow} onChange={follow} noValidate>
        <div className="row2">
          {selects.map((field) => (
            <div key={field.name} className="field">
              <label htmlFor={`e-${field.name}`}>{field.label}</label>
              <select className="input" id={`e-${field.name}`} name={field.name} defaultValue={blank[field.name]}>
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              {field.hint && <span className="hint">{field.hint}</span>}
            </div>
          ))}
        </div>
        <fieldset className="field plain-fieldset">
          <legend className="label-text">Key areas · optional</legend>
          <div className="chips">
            {AREAS.map((area) => (
              <label key={area} className="chip">
                <input className="sr-only" type="checkbox" name="areas" value={area} />
                {area}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="e-note">What you learned · optional</label>
          <textarea
            className="input"
            id="e-note"
            name="note"
            rows={3}
            maxLength={CASEBOOK_LIMITS.note}
            placeholder="Pushed back on a stock provision that relied on one supplier quote."
            aria-describedby="e-guard"
            aria-invalid={warnings.length || add.error('note') ? true : undefined}
          />
          <div className="guard" id="e-guard" aria-live="polite">
            {warnings.length ? (
              warnings.map((warning) => (
                <span key={warning} className="warn">
                  <svg aria-hidden="true">
                    <use href="#i-flag" />
                  </svg>
                  <span>{warning}</span>
                </span>
              ))
            ) : (
              <span className="okline">
                <Tick source="register" state="ticked" /> Nothing here points at a client.
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="e-cosign">Who can co-sign it · optional</label>
          <div className="prefix">
            <input className="input" id="e-cosign" name="cosigner" autoComplete="off" spellCheck={false} aria-describedby="e-cosign-hint" />
          </div>
          <span className="hint" id="e-cosign-hint">
            The handle of a colleague with the seal who worked on it or reviewed it. They confirm it in their notifications.
          </span>
        </div>
        <div className="panel-foot">
          <span className="small">It shows on your heatmap now. Co-signed once they confirm.</span>
          <button className="btn" type="submit" disabled={add.busy}>
            Add to casebook
          </button>
        </div>
      </form>
      <aside className="aside-stack" aria-label="Preview">
        <p className="kicker">Preview</p>
        <article className="entry card">
          <p className="head">
            <span>{draft.service}</span> · <span>{draft.industry}</span>
          </p>
          <dl>
            <dt>Band</dt>
            <dd>{draft.band}</dd>
            <dt>Framework</dt>
            <dd>{draft.framework}</dd>
            <dt>Year</dt>
            <dd>{draft.year}</dd>
            <dt>Role</dt>
            <dd>{draft.role}</dd>
            <dt>Areas</dt>
            <dd>{draft.areas.join(', ') || 'None picked'}</dd>
          </dl>
          <p className="cosign">
            <Tick source="self" state="self" />
            <span>{cosigner ? `Waiting on @${cosigner} to co-sign` : 'Not co-signed'}</span>
          </p>
        </article>
      </aside>
    </div>
  );
}

function RoleForm({ thisYear, onDone, onRefused }: { thisYear: number; onDone: () => void; onRefused: (message: string | null) => void }) {
  const add = useAction(addRole);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const one = (name: string) => String(data.get(name) ?? '');
    const outcome = await add.run({ from: one('from'), to: one('to'), title: one('title'), employer: one('employer') });
    if (!outcome.ok) return onRefused(Object.keys(outcome.fields).length ? null : outcome.message);
    form.reset();
    onDone();
  };

  return (
    <form method="POST" ref={add.form} onSubmit={submit} noValidate className="role-form">
      <div className="row2">
        <div className="field">
          <label htmlFor="r-title">What you did</label>
          <input
            className="input"
            id="r-title"
            name="title"
            maxLength={ROLE_LIMITS.title}
            placeholder="Audit senior to manager"
            aria-invalid={add.error('title') ? true : undefined}
            aria-describedby={add.error('title') ? 'r-title-error' : undefined}
          />
          {add.error('title') && (
            <span className="error" id="r-title-error">
              {add.error('title')}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="r-employer">Kind of employer</label>
          <select className="input" id="r-employer" name="employer">
            {EMPLOYER_KINDS.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-from">From</label>
          <input
            className="input"
            id="r-from"
            name="from"
            inputMode="numeric"
            min={ROLE_LIMITS.earliest}
            max={thisYear}
            placeholder={String(thisYear - 3)}
            aria-invalid={add.error('from') ? true : undefined}
            aria-describedby={add.error('from') ? 'r-from-error' : undefined}
          />
          {add.error('from') && (
            <span className="error" id="r-from-error">
              {add.error('from')}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="r-to">To · blank if you are still there</label>
          <input
            className="input"
            id="r-to"
            name="to"
            inputMode="numeric"
            min={ROLE_LIMITS.earliest}
            max={thisYear}
            aria-invalid={add.error('to') ? true : undefined}
            aria-describedby={add.error('to') ? 'r-to-error' : undefined}
          />
          {add.error('to') && (
            <span className="error" id="r-to-error">
              {add.error('to')}
            </span>
          )}
        </div>
      </div>
      <div className="panel-foot">
        <span className="small">Roles draw your timeline.</span>
        <button className="btn sm" type="submit" disabled={add.busy}>
          Add role
        </button>
      </div>
    </form>
  );
}

function RemoveEntry({ entry, onDone, onRefused }: { entry: Data['entries'][number]; onDone: () => void; onRefused: (message: string) => void }) {
  const remove = useAction(removeEntry);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await remove.run({ entry: entry.id });
    if (outcome.ok) onDone();
    else onRefused(outcome.message);
  };
  return (
    <details className="remove">
      <summary className="act">
        Remove
        <span className="sr-only">
          {' '}
          {entry.service} · {entry.industry}, {entry.year}
        </span>
      </summary>
      <form method="POST" onSubmit={submit}>
        <p className="small">Take it off your casebook? A co-sign goes with it.</p>
        <button className="btn sm danger" type="submit" disabled={remove.busy}>
          Remove entry
        </button>
      </form>
    </details>
  );
}

function RemoveRole({ role, onDone, onRefused }: { role: Data['roles'][number]; onDone: () => void; onRefused: (message: string) => void }) {
  const remove = useAction(removeRole);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await remove.run({ role: role.id });
    if (outcome.ok) onDone();
    else onRefused(outcome.message);
  };
  return (
    <details className="remove">
      <summary className="act">
        Remove<span className="sr-only"> {role.title}</span>
      </summary>
      <form method="POST" onSubmit={submit}>
        <button className="btn sm danger" type="submit" disabled={remove.busy}>
          Remove role
        </button>
      </form>
    </details>
  );
}
