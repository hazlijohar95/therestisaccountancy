import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { BODIES, bodyById, CLAIM_LIMITS, LICENCES, PLATFORMS, type Body } from '../../../../../src/data/social.ts';
import type { ClaimKind } from '../../../../../src/server/social-claims.ts';
import { Avatar } from '../../../components/social/Avatar.tsx';
import { SocialLink } from '../../../components/social/SocialLink.tsx';
import { Tick } from '../../../components/social/Tick.tsx';
import { describedBy, useAction } from '../../../components/social/useAction.ts';
import { addAcademic, addAccount, addBody, addExperience, addLicence, removeAccount, removeClaim, sendWorkEmail, verifyPage } from '../../../functions/social-ticks.ts';
import { socialSignInHref } from '../../../lib/links.ts';
import { noindex, socialTitle } from '../../../lib/title.ts';

const STEPS = [
  { id: 'account', name: 'Prove your account', sub: 'A code in your bio' },
  { id: 'body', name: 'Add your body', sub: 'Your exact status' },
  { id: 'licence', name: 'Licence', sub: 'Optional' },
  { id: 'work', name: 'Where you work', sub: 'Optional' },
] as const;
type Step = (typeof STEPS)[number]['id'];

/* What each form says once it has worked. */
const DONE = {
  addAccount: 'Account added. Put the code in its bio, then leave it there until we have looked.',
  removeAccount: 'Account removed.',
  addBody: 'Sent. Someone on the team checks it against the body’s register, or reads your certificate.',
  addLicence: 'Sent. Someone on the team reads the document, then deletes it.',
  addAcademic: 'Sent. Someone on the team checks the page.',
  addExperience: 'Added to your profile as self-declared. Three members with the seal can vouch for it.',
  removeClaim: 'Removed.',
  sendWorkEmail: 'Link sent. Open it from your work inbox, signed in here, within seven days.',
} as const;
type Form = keyof typeof DONE;

const stepOfKind: Record<ClaimKind, Step> = { body: 'body', licence: 'licence', employer: 'work', academic: 'work', experience: 'work' };
const UPLOAD_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';

interface VerifySearch {
  step?: Step | undefined;
  body?: string | undefined;
  done?: 'confirmWorkEmail' | undefined;
}

export const Route = createFileRoute('/social/verify/')({
  staticData: { section: 'verify' },
  validateSearch: (search: Record<string, unknown>): VerifySearch => ({
    step: STEPS.find((s) => s.id === search['step'])?.id,
    body: typeof search['body'] === 'string' ? search['body'] : undefined,
    done: search['done'] === 'confirmWorkEmail' ? 'confirmWorkEmail' : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/verify') });
  },
  loader: () => verifyPage(),
  head: () => ({ meta: [...socialTitle('Get ticked'), noindex] }),
  component: Verify,
});

type Data = Awaited<ReturnType<typeof verifyPage>>;

/** The fields a form posted, as text, for a server function that takes an object. */
const read = (form: HTMLFormElement, ...names: string[]) => {
  const data = new FormData(form);
  return Object.fromEntries(names.map((name) => [name, String(data.get(name) ?? '')]));
};

function Verify() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const step: Step = search.step ?? 'account';
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const [done, setDone] = useState<Form | null>(null);
  const [removeFailure, setRemoveFailure] = useState<string | null>(null);

  useEffect(() => setDone(null), [step, search.body]);

  const ticked = data.claims.filter((c) => c.state === 'ticked').length + data.accounts.filter((a) => a.state === 'proven').length;
  const waiting = data.claims.filter((c) => c.state === 'pending').length + data.accounts.filter((a) => a.state === 'pending').length;
  const ofKind = (...kinds: ClaimKind[]) => data.claims.filter((c) => kinds.includes(c.kind));
  const stepDone: Record<Step, boolean> = {
    account: data.accounts.some((a) => a.state === 'proven'),
    body: ofKind('body').some((c) => c.state === 'ticked'),
    licence: ofKind('licence').some((c) => c.state === 'ticked'),
    work: ofKind('employer', 'academic', 'experience').some((c) => c.state === 'ticked'),
  };
  const finished = (form: Form) => {
    setRemoveFailure(null);
    setDone(form);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="kicker">Get ticked</p>
          <h1 className="title">Every claim, one tick at a time.</h1>
          <p className="lead">People on the team check each claim by hand. It takes a few days, and we email you when it is done.</p>
        </div>
        <SocialLink className="small" path="/ticks">
          What a tick means
        </SocialLink>
      </div>

      {done && (
        <p className="note" role="status">
          {DONE[done]}
        </p>
      )}
      {search.done === 'confirmWorkEmail' && (
        <p className="note" role="status">
          Work email confirmed. It shows on your profile now.
        </p>
      )}

      <div className="verify">
        <nav aria-label="Steps">
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.id} data-s={stepDone[s.id] ? 'done' : s.id === step ? 'now' : 'next'}>
                <SocialLink path={`/verify?step=${s.id}`} aria-current={s.id === step ? 'step' : undefined}>
                  <span className="n">
                    {stepDone[s.id] ? (
                      <svg aria-hidden="true">
                        <use href="#tk" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span>
                    {s.name}
                    {stepDone[s.id] && <span className="sr-only">, ticked</span>}
                    <small>{s.sub}</small>
                  </span>
                </SocialLink>
              </li>
            ))}
          </ol>
        </nav>

        <section className="panel card" aria-labelledby="step-title">
          <p className="kicker">
            Step {stepIndex + 1} of {STEPS.length}
            {stepIndex >= 2 && ' · Optional'}
          </p>
          {step === 'account' && <AccountStep data={data} onDone={finished} />}
          {step === 'body' && <BodyStep key={search.body ?? ''} data={data} body={bodyById(search.body ?? '')} onDone={finished} />}
          {step === 'licence' && <LicenceStep data={data} onDone={finished} />}
          {step === 'work' && <WorkStep data={data} onDone={finished} />}
        </section>
      </div>

      <section className="section card" aria-labelledby="mine-title">
        <header>
          <h2 className="head" id="mine-title">
            Your ticks
          </h2>
          <span className="small">
            {ticked} ticked · {waiting} waiting
          </span>
        </header>
        {removeFailure && (
          <p className="error" role="alert">
            {removeFailure}
          </p>
        )}
        <div className="claims-wrap">
          {data.accounts.length + data.claims.length === 0 ? (
            <div className="empty">
              <p>Nothing yet. Start by proving an account.</p>
            </div>
          ) : (
            <table className="claims">
              <caption className="sr-only">Your accounts and claims, and where each stands</caption>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={`account-${a.id}`} data-state={a.state === 'proven' ? 'ticked' : a.state}>
                    <td>
                      <Tick source="account" state={a.state === 'proven' ? 'ticked' : a.state} />
                    </td>
                    <td className="what">
                      {a.platform} · @{a.handle}
                    </td>
                    <td className="when">{a.state === 'proven' ? 'Proven' : a.state === 'rejected' ? `Not proven: ${a.reason}` : `Waiting for the team · ${a.code}`}</td>
                    <td className="row-action">
                      <Remove
                        what={`${a.platform} @${a.handle}`}
                        warning={a.state === 'proven' ? 'Your seal needs a proven account.' : 'You can add it again later.'}
                        target={{ kind: 'account', id: a.id }}
                        onDone={() => finished('removeAccount')}
                        onRefused={setRemoveFailure}
                      />
                    </td>
                  </tr>
                ))}
                {data.claims.map((c) => {
                  const renew = `/verify?step=${stepOfKind[c.kind]}${c.bodyId ? `&body=${c.bodyId}` : ''}`;
                  return (
                    <tr key={`claim-${c.id}`} data-state={c.state}>
                      <td>
                        <Tick source={c.source} state={c.tick} vouches={c.vouches} />
                      </td>
                      <td className="what">{c.label}</td>
                      <td className="when">
                        {c.when}
                        {c.due !== null && (
                          <>
                            <br />
                            <SocialLink className="due-chip" path={renew}>
                              Renews in {c.due} {c.due === 1 ? 'day' : 'days'}. Renew it
                            </SocialLink>
                          </>
                        )}
                        {c.state === 'lapsed' && (
                          <>
                            <br />
                            <SocialLink className="due-chip" path={renew}>
                              Renew it
                            </SocialLink>
                          </>
                        )}
                      </td>
                      <td className="row-action">
                        <Remove
                          what={c.label}
                          warning={c.state === 'ticked' ? 'Getting it back means a new check.' : 'You can send it again later.'}
                          target={{ kind: 'claim', id: c.id }}
                          onDone={() => finished('removeClaim')}
                          onRefused={setRemoveFailure}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

interface StepProps {
  data: Data;
  onDone: (form: Form) => void;
}

function AccountStep({ data, onDone }: StepProps) {
  const add = useAction(addAccount);
  const pending = data.accounts.filter((a) => a.state === 'pending');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const { platform = '', handle = '' } = read(form, 'platform', 'handle');
    const outcome = await add.run({ platform, handle });
    if (!outcome.ok) return;
    form.reset();
    onDone('addAccount');
  };

  return (
    <>
      <h2 className="head" id="step-title">
        Prove the account is yours.
      </h2>
      <p>Add the account you post from. We give you a code to put in its bio. Someone on the team opens your profile and looks for it.</p>
      {pending.map((a) => (
        <div key={a.id}>
          <div className="code-box">
            <div>
              <span className="kicker">Put this in your {a.platform} bio</span>
              <code>{a.code}</code>
            </div>
            <span className="hand-note">leave it until we email you</span>
          </div>
          <div className="bio-preview">
            <Avatar name={data.profile.name} track={data.profile.track} size="sm" />
            <span>
              <b>@{a.handle}</b> · {data.profile.headline || 'Your bio as it is now.'} <mark>{a.code}</mark>
            </span>
          </div>
        </div>
      ))}
      <form method="POST" ref={add.form} onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset">
          <legend className="label-text">Platform</legend>
          <div className="chips">
            {PLATFORMS.map((p) => (
              <label key={p} className="chip">
                <input className="sr-only" type="radio" name="platform" value={p} defaultChecked={p === 'LinkedIn'} aria-invalid={add.error('platform') ? true : undefined} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="account-handle">Your handle there</label>
          <input
            className="input"
            id="account-handle"
            name="handle"
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="aisyahaudits"
            aria-invalid={add.error('handle') ? true : undefined}
            aria-describedby={describedBy('account-handle-hint', add.error('handle') && 'addAccount-handle-error')}
          />
          <span className="hint" id="account-handle-hint">
            The handle, or paste your profile’s address.
          </span>
          {add.error('handle') && (
            <span className="error" id="addAccount-handle-error">
              {add.error('handle')}
            </span>
          )}
        </div>
        {add.refusal && (
          <p className="error" role="alert">
            {add.refusal.message}
          </p>
        )}
        <div className="panel-foot">
          <span className="small">We only look at the public profile.</span>
          <button className="btn" type="submit" disabled={add.busy}>
            Get a code
          </button>
        </div>
      </form>
    </>
  );
}

/** Checks a chosen file before it is sent, in the server's words: a file over the limit would never arrive. */
const tooBig = (form: HTMLFormElement) => {
  const file = new FormData(form).get('evidence');
  return file instanceof File && file.size > CLAIM_LIMITS.evidenceBytes;
};

function BodyStep({ data, body, onDone }: StepProps & { body: Body | undefined }) {
  const add = useAction(addBody);
  const [large, setLarge] = useState(false);
  const fileError = large ? 'Upload a file under 5 MB.' : add.error('evidence');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setLarge(tooBig(form));
    if (tooBig(form)) return form.querySelector<HTMLInputElement>('#body-evidence')?.focus();
    const outcome = await add.run(new FormData(form));
    if (!outcome.ok) return;
    form.reset();
    onDone('addBody');
  };

  return (
    <>
      <h2 className="head" id="step-title">
        Which body are you with?
      </h2>
      <div className="bodies">
        {BODIES.map((b) => (
          <SocialLink key={b.id} className="body-btn" path={`/verify?step=body&body=${b.id}`} aria-current={body?.id === b.id ? 'true' : undefined}>
            {b.name}
            <small>{b.region}</small>
          </SocialLink>
        ))}
      </div>
      {body ? (
        <form method="POST" ref={add.form} onSubmit={submit} encType={body.id === 'other' ? 'multipart/form-data' : undefined} noValidate>
          <input type="hidden" name="body" value={body.id} />
          <fieldset className="plain-fieldset" aria-describedby={add.error('status') ? 'addBody-status-error' : undefined}>
            <legend className="label-text">Your exact status</legend>
            <div className="status-pills">
              {body.statuses.map((s) => (
                <label key={s.name} className="chip">
                  <input className="sr-only" type="radio" name="status" value={s.name} data-training={s.track === 'training' ? '' : undefined} aria-invalid={add.error('status') ? true : undefined} />
                  {s.name}
                </label>
              ))}
            </div>
            {add.error('status') && (
              <span className="error" id="addBody-status-error">
                {add.error('status')}
              </span>
            )}
          </fieldset>
          <div className="note tip plain when-picked exact">
            <Tick source="register" state="ticked" />
            <span>We show your status exactly. A student status is a real milestone, and it reads as one.</span>
          </div>
          {body.id === 'mia' && (
            <div className="note tip when-picked cam">
              <Tick source="register" state="ticked" />
              <span>CA(M) is a protected title. It shows only once the team has found you on the MIA register as a Chartered Accountant.</span>
            </div>
          )}
          {body.id === 'other' && (
            <div className="field">
              <label htmlFor="body-other">Name of the body</label>
              <input
                className="input"
                id="body-other"
                name="otherName"
                maxLength={CLAIM_LIMITS.otherBody}
                placeholder="AICPA"
                aria-invalid={add.error('otherName') ? true : undefined}
                aria-describedby={add.error('otherName') ? 'addBody-otherName-error' : undefined}
              />
              {add.error('otherName') && (
                <span className="error" id="addBody-otherName-error">
                  {add.error('otherName')}
                </span>
              )}
            </div>
          )}
          <div className="row2">
            <div className="field">
              <label htmlFor="body-number">Member or student number</label>
              <input
                className="input"
                id="body-number"
                name="reference"
                maxLength={CLAIM_LIMITS.reference}
                autoComplete="off"
                aria-invalid={add.error('reference') ? true : undefined}
                aria-describedby={describedBy('body-number-hint', add.error('reference') && 'addBody-reference-error')}
              />
              <span className="hint" id="body-number-hint">
                Only the team sees it.
              </span>
              {add.error('reference') && (
                <span className="error" id="addBody-reference-error">
                  {add.error('reference')}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="body-name">Name on the register</label>
              <input className="input" id="body-name" value={data.name} disabled aria-describedby="body-name-hint" />
              <span className="hint" id="body-name-hint">
                Your account’s name. It must match.
              </span>
            </div>
          </div>
          {body.id === 'other' && (
            <>
              <p className="small">We have no register to look at for this body. Upload your certificate: someone on the team reads it, and it is deleted once they decide.</p>
              <label className="code-box upload" htmlFor="body-evidence">
                <svg className="ic" aria-hidden="true">
                  <use href="#i-file" />
                </svg>
                <span>
                  <b>Your certificate</b>
                  <br />
                  <span className="small">A PDF or a photo, up to 5 MB.</span>
                </span>
                <input
                  id="body-evidence"
                  type="file"
                  name="evidence"
                  accept={UPLOAD_TYPES}
                  aria-invalid={fileError ? true : undefined}
                  aria-describedby={fileError ? 'addBody-evidence-error' : undefined}
                  onChange={() => setLarge(false)}
                />
              </label>
              {fileError && (
                <span className="error" id="addBody-evidence-error">
                  {fileError}
                </span>
              )}
            </>
          )}
          {add.refusal && (
            <p className="error" role="alert">
              {add.refusal.message}
            </p>
          )}
          <div className="panel-foot">
            <span className="small">{body.id === 'other' ? 'A person reads it. It takes a few days.' : 'A person checks the register. It takes a few days.'}</span>
            <button className="btn" type="submit" disabled={add.busy}>
              Send to the team
            </button>
          </div>
        </form>
      ) : (
        <div className="panel-foot">
          <span className="small">Pick the body you belong to. Add each one you are with.</span>
          <SocialLink className="btn ghost sm" path="/verify?step=licence">
            Not a member yet. Skip.
          </SocialLink>
        </div>
      )}
    </>
  );
}

function LicenceStep({ data, onDone }: StepProps) {
  const add = useAction(addLicence);
  const [large, setLarge] = useState(false);
  const fileError = large ? 'Upload a file under 5 MB.' : add.error('evidence');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setLarge(tooBig(form));
    if (tooBig(form)) return form.querySelector<HTMLInputElement>('#licence-evidence')?.focus();
    const outcome = await add.run(new FormData(form));
    if (!outcome.ok) return;
    form.reset();
    onDone('addLicence');
  };

  return (
    <>
      <h2 className="head" id="step-title">
        Do you hold a licence?
      </h2>
      <form method="POST" ref={add.form} onSubmit={submit} encType="multipart/form-data" noValidate>
        <fieldset className="plain-fieldset" aria-describedby={add.error('licence') ? 'addLicence-licence-error' : undefined}>
          <legend className="label-text">Licence</legend>
          <div className="bodies">
            {LICENCES.map((l) => (
              <label key={l} className="body-btn">
                <input className="sr-only" type="radio" name="licence" value={l} aria-invalid={add.error('licence') ? true : undefined} />
                {l}
              </label>
            ))}
          </div>
          {add.error('licence') && (
            <span className="error" id="addLicence-licence-error">
              {add.error('licence')}
            </span>
          )}
        </fieldset>
        <div className="row2">
          <div className="field">
            <label htmlFor="licence-number">Licence or certificate number</label>
            <input
              className="input"
              id="licence-number"
              name="reference"
              maxLength={CLAIM_LIMITS.reference}
              autoComplete="off"
              aria-invalid={add.error('reference') ? true : undefined}
              aria-describedby={add.error('reference') ? 'addLicence-reference-error' : undefined}
            />
            {add.error('reference') && (
              <span className="error" id="addLicence-reference-error">
                {add.error('reference')}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="licence-until">Valid until</label>
            <input
              className="input"
              id="licence-until"
              type="month"
              name="until"
              min={data.thisMonth}
              placeholder="2027-12"
              aria-invalid={add.error('until') ? true : undefined}
              aria-describedby={describedBy('licence-until-hint', add.error('until') && 'addLicence-until-error')}
            />
            <span className="hint" id="licence-until-hint">
              The month on the licence. The tick lapses when it ends.
            </span>
            {add.error('until') && (
              <span className="error" id="addLicence-until-error">
                {add.error('until')}
              </span>
            )}
          </div>
        </div>
        <label className="code-box upload" htmlFor="licence-evidence">
          <svg className="ic" aria-hidden="true">
            <use href="#i-file" />
          </svg>
          <span>
            <b>Proof of the licence</b>
            <br />
            <span className="small">A PDF or a photo, up to 5 MB. Deleted once we decide.</span>
          </span>
          <input
            id="licence-evidence"
            type="file"
            name="evidence"
            accept={UPLOAD_TYPES}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? 'addLicence-evidence-error' : undefined}
            onChange={() => setLarge(false)}
          />
        </label>
        {fileError && (
          <span className="error" id="addLicence-evidence-error">
            {fileError}
          </span>
        )}
        {add.refusal && (
          <p className="error" role="alert">
            {add.refusal.message}
          </p>
        )}
        <div className="panel-foot">
          <SocialLink className="btn ghost sm" path="/verify?step=work">
            Skip
          </SocialLink>
          <button className="btn" type="submit" disabled={add.busy}>
            Send to the team
          </button>
        </div>
      </form>
    </>
  );
}

function WorkStep({ data, onDone }: StepProps) {
  const work = useAction(sendWorkEmail);
  const academic = useAction(addAcademic);
  const experience = useAction(addExperience);
  /* A refusal that is not about the address's shape still is about the address, so it shows beside it. */
  const workFailure = work.refusal && !Object.keys(work.refusal.fields).length ? work.refusal.message : null;

  const submitWork = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await work.run({ email: read(form, 'email')['email'] ?? '' });
    if (!outcome.ok) return;
    form.reset();
    onDone('sendWorkEmail');
  };
  const submitAcademic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const { role = '', url = '' } = read(form, 'role', 'url');
    const outcome = await academic.run({ role, url });
    if (!outcome.ok) return;
    form.reset();
    onDone('addAcademic');
  };
  const submitExperience = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await experience.run({ text: read(form, 'text')['text'] ?? '' });
    if (!outcome.ok) return;
    form.reset();
    onDone('addExperience');
  };

  return (
    <>
      <h2 className="head" id="step-title">
        Where do you work?
      </h2>
      <form method="POST" ref={work.form} onSubmit={submitWork} noValidate>
        <div className="field">
          <label htmlFor="work-email">Work email</label>
          <input
            className="input"
            id="work-email"
            name="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="you@yourfirm.com"
            aria-invalid={work.error('email') || workFailure ? true : undefined}
            aria-describedby={describedBy('work-email-hint', work.error('email') && 'sendWorkEmail-email-error', workFailure && 'work-email-failure')}
          />
          <span className="hint" id="work-email-hint">
            We send one link. Only the domain shows on your profile.
          </span>
          {work.error('email') && (
            <span className="error" id="sendWorkEmail-email-error">
              {work.error('email')}
            </span>
          )}
          {workFailure && (
            <span className="error" id="work-email-failure">
              {workFailure}
            </span>
          )}
        </div>
        <div className="panel-foot">
          <span className="small">Open the link signed in here. Nothing else is checked.</span>
          <button className="btn" type="submit" disabled={work.busy}>
            Send link
          </button>
        </div>
      </form>

      <form className="sub" method="POST" ref={academic.form} onSubmit={submitAcademic} noValidate>
        <h3>Teach or research?</h3>
        <div className="row2">
          <div className="field">
            <label htmlFor="academic-role">Your post</label>
            <input
              className="input"
              id="academic-role"
              name="role"
              maxLength={CLAIM_LIMITS.label}
              placeholder="Senior lecturer, Universiti Malaya"
              aria-invalid={academic.error('role') ? true : undefined}
              aria-describedby={academic.error('role') ? 'addAcademic-role-error' : undefined}
            />
            {academic.error('role') && (
              <span className="error" id="addAcademic-role-error">
                {academic.error('role')}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="academic-url">Staff page or ORCID</label>
            <input
              className="input"
              id="academic-url"
              name="url"
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder="https://orcid.org/…"
              aria-invalid={academic.error('url') ? true : undefined}
              aria-describedby={academic.error('url') ? 'addAcademic-url-error' : undefined}
            />
            {academic.error('url') && (
              <span className="error" id="addAcademic-url-error">
                {academic.error('url')}
              </span>
            )}
          </div>
        </div>
        {academic.refusal && (
          <p className="error" role="alert">
            {academic.refusal.message}
          </p>
        )}
        <div className="panel-foot">
          <span className="small">Someone on the team opens the page and checks your name is on it.</span>
          <button className="btn ghost" type="submit" disabled={academic.busy}>
            Send to the team
          </button>
        </div>
      </form>

      <form className="sub" method="POST" ref={experience.form} onSubmit={submitExperience} noValidate>
        <h3>Experience</h3>
        <div className="field">
          <label htmlFor="experience-text">In a line</label>
          <input
            className="input"
            id="experience-text"
            name="text"
            maxLength={CLAIM_LIMITS.label}
            placeholder="Six years in audit"
            aria-invalid={experience.error('text') ? true : undefined}
            aria-describedby={describedBy('experience-hint', experience.error('text') && 'addExperience-text-error')}
          />
          <span className="hint" id="experience-hint">
            It shows as self-declared. Three members with the seal can vouch for it, and then it is ticked.
          </span>
          {experience.error('text') && (
            <span className="error" id="addExperience-text-error">
              {experience.error('text')}
            </span>
          )}
        </div>
        {experience.refusal && (
          <p className="error" role="alert">
            {experience.refusal.message}
          </p>
        )}
        <div className="panel-foot">
          <SocialLink className="btn ghost sm" path={`/@${data.profile.handle}`}>
            See your profile
          </SocialLink>
          <button className="btn ghost" type="submit" disabled={experience.busy}>
            Add it
          </button>
        </div>
      </form>
    </>
  );
}

/** A row's Remove: a disclosure with the warning and the button, so one press never removes by accident. */
function Remove({
  what,
  warning,
  target,
  onDone,
  onRefused,
}: {
  what: string;
  warning: string;
  target: { kind: 'account' | 'claim'; id: number };
  onDone: () => void;
  onRefused: (message: string) => void;
}) {
  const account = useAction(removeAccount);
  const claim = useAction(removeClaim);
  const busy = account.busy || claim.busy;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = target.kind === 'account' ? await account.run({ account: target.id }) : await claim.run({ claim: target.id });
    if (outcome.ok) onDone();
    else onRefused(outcome.message);
  };

  return (
    <details className="remove">
      <summary className="linkish">
        Remove<span className="sr-only"> {what}</span>
      </summary>
      <form method="POST" onSubmit={submit}>
        <span className="small">{warning}</span>
        <button className="btn sm danger" type="submit" disabled={busy}>
          Remove it
        </button>
      </form>
    </details>
  );
}
