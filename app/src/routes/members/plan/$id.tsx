import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { hostFirstName } from '../../../../../src/data/authors.ts';
import { formatDay } from '../../../../../src/lib/format.ts';
import { PlanLetter } from '../../../components/club/PlanLetter.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Actions, Section } from '../../../components/ui/Section.tsx';
import { useAction } from '../../../components/useAction.ts';
import { membersAnsweredPlan, startPlan } from '../../../functions/members-plans.ts';
import { clubTitle } from '../../../lib/title.ts';

export const Route = createFileRoute('/members/plan/$id')({
  loader: ({ params }) => membersAnsweredPlan({ data: params.id }),
  head: () => ({ meta: clubTitle('Your plan, answered') }),
  component: AnsweredPlan,
});

function AnsweredPlan() {
  const { plan, open, isLatest } = Route.useLoaderData();
  const navigate = useNavigate();
  const start = useAction(startPlan, { refresh: 'never' });

  const startNext = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await start.run(undefined);
    if (outcome?.ok) await navigate({ to: '/members/plan', search: { started: true } });
  };

  return (
    <>
      <PageHead
        label={
          <span>
            <a href="/members/plan">Your plan</a> / Answered
          </span>
        }
        title={`Your plan of ${formatDay(plan.sentAt)}`}
        lead={`Answered by ${plan.reply.by ?? hostFirstName} on ${formatDay(plan.reply.at)}.`}
      />

      {start.refusal && <Notice tone="error">{start.refusal.message}</Notice>}

      <Section title="Your plan and the answer">
        <PlanLetter plan={plan} level={3} />
      </Section>

      <Section title="What next">
        {open ? (
          <Actions>
            <a href="/members/plan">Back to the plan you are writing now</a>
          </Actions>
        ) : isLatest ? (
          <>
            <p className="small">The next plan starts from this one, so you only change what has moved. The question for {hostFirstName} starts blank.</p>
            <form method="POST" onSubmit={startNext}>
              <Actions>
                <button className="btn" type="submit">
                  Start the next plan
                </button>
              </Actions>
            </form>
          </>
        ) : (
          <Actions>
            <a href="/members/plan">All your plans</a>
          </Actions>
        )}
      </Section>
    </>
  );
}
