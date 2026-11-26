import { useRef, type FormEvent } from 'react';
import { reasonsFor, REPORT_NOTE_MAX, type ReportTarget } from '../../../../src/data/social.ts';
import { report } from '../../functions/social-floor.ts';
import { useSay } from './Notice.tsx';
import { useAction } from '../useAction.ts';

/** A Report button and its dialog, for a post or reply (by id) or a profile (by handle). */
export function ReportDialog({ target, id, handle, about, className = 'act' }: { target: ReportTarget; id?: number; handle?: string; about: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const send = useAction(report, { refresh: 'never' });
  const say = useSay();
  const name = `report-${target}-${id ?? handle ?? ''}`;
  const reasons = reasonsFor(target);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = await send.run({ target, id, handle, reason: String(form.get('reason') ?? ''), note: String(form.get('note') ?? '') });
    if (!outcome?.ok) return;
    dialog.current?.close();
    say({ tone: 'note', text: 'Report sent. A person on the team reads every one.' });
  };

  return (
    <>
      <button className={className} type="button" onClick={() => dialog.current?.showModal()}>
        <svg aria-hidden="true">
          <use href="#i-flag" />
        </svg>
        Report<span className="sr-only"> {about}</span>
      </button>
      <dialog className="modal card" id={name} ref={dialog} aria-labelledby={`${name}-title`}>
        <form method="POST" onSubmit={submit}>
          <p className="kicker">Report {about}</p>
          <h2 className="head" id={`${name}-title`}>
            What’s wrong?
          </h2>
          <fieldset className="radios">
            <legend className="sr-only">Reason</legend>
            {reasons.map((reason, i) => (
              <label className="radio" key={reason.id}>
                <input type="radio" name="reason" value={reason.id} defaultChecked={i === 0} />
                {reason.label}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={`${name}-note`}>Anything we should know · optional</label>
            <textarea className="input" id={`${name}-note`} name="note" rows={3} maxLength={REPORT_NOTE_MAX} />
          </div>
          {send.refusal && (
            <p className="error" role="alert">
              {send.refusal.message}
            </p>
          )}
          <div className="row-end">
            <span className="small">A person on the team reads every report.</span>
            <button className="btn" type="submit">
              Send report
            </button>
          </div>
        </form>
        <button className="icon-btn close" type="button" onClick={() => dialog.current?.close()} aria-label="Close dialog">
          <svg aria-hidden="true">
            <use href="#i-x" />
          </svg>
        </button>
      </dialog>
    </>
  );
}
