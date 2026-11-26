import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { formatDay } from '../../../../../src/lib/format.ts';
import { Masthead } from '../../../components/club/Masthead.tsx';
import { Notice } from '../../../components/club/Notice.tsx';
import { PlanLetter } from '../../../components/club/PlanLetter.tsx';
import { membersAnsweredPlan, startPlan } from '../../../functions/members-plans.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './$id.module.css';
import { hostFirstName } from '../../../../../src/data/authors.ts';

export const Route = createFileRoute('/members/plan/$id')({
  loader: ({ params }) => membersAnsweredPlan({ data: params.id }),
  head: () => ({ meta: clubTitle('Your plan, answered') }),
  component: AnsweredPlan,
});

function AnsweredPlan() {
  const { plan, open, isLatest } = Route.useLoaderData();
  const navigate = useNavigate();
  const start = useServerFn(startPlan);
  const [error, setError] = useState<string | null>(null);

  const startNext = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await start();
    if (outcome.ok) return navigate({ to: '/members/plan', search: { started: true } });
    setError(outcome.message);
  };

  return (
    <>
      <Masthead
        label={
          <span>
            <a href="/members/plan">Your plan</a> / Answered
          </span>
        }
        title={`Your plan of ${formatDay(plan.sentAt)}`}
        narrow
      >
        <p>
          Answered by {plan.reply.by ?? hostFirstName} on {formatDay(plan.reply.at)}. Your sections first, then the answer.
        </p>
      </Masthead>

      {error && <Notice tone="error">{error}</Notice>}

      <article className={`wrap ${s.block}`} aria-label="Your plan and the answer">
        <PlanLetter plan={plan} level={2} />
      </article>

      <section className={`wrap ${s.block}`} aria-label="What next">
        <div className={s.next}>
          {open ? (
            <p>
              <a href="/members/plan">Back to the plan you are writing now</a>
            </p>
          ) : isLatest ? (
            <>
              <p>When you are ready, write the next one. It starts from this plan, so you only change what has moved. The question for {hostFirstName} starts blank.</p>
              <form method="POST" onSubmit={startNext}>
                <button className="btn" type="submit">
                  Start the next plan
                </button>
              </form>
            </>
          ) : (
            <p>
              <a href="/members/plan">All your plans</a>
            </p>
          )}
        </div>
      </section>
    </>
  );
}
