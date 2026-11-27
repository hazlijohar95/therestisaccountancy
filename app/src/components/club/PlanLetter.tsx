import { planSections } from '../../../../src/data/plan.ts';
import { formatDay } from '../../../../src/lib/format.ts';
import type { PlanAnswers, PlanReply } from '../../../../src/server/plans.ts';
import { PostText } from '../PostText.tsx';
import { Badge } from '../ui/Badge.tsx';
import s from './PlanLetter.module.css';

const number = (i: number) => String(i + 1).padStart(2, '0');

/** A plan read as a letter: the member's sections in order, then the host's answer, set apart. */
export function PlanLetter({ plan, level = 2 }: { plan: { readonly answers: PlanAnswers; readonly reply?: PlanReply | null }; level?: 2 | 3 | 4 }) {
  const Heading = `h${level}` as const;
  return (
    <div className={s.letter}>
      <ol className={s.sections}>
        {planSections.map((section, i) => {
          const answer = plan.answers[section.slug];
          return (
            <li key={section.slug} className={s.section}>
              <Heading className={s.heading}>
                <span className={`serif ${s.n}`} aria-hidden="true">
                  {number(i)}
                </span>
                {section.heading}
              </Heading>
              {answer ? <PostText text={answer} /> : <p className={s.blank}><Badge>Not written yet</Badge></p>}
            </li>
          );
        })}
      </ol>
      {plan.reply && (
        <section className={`night ${s.answer}`} aria-label="The answer">
          <p className={`label ${s.top}`}>The answer</p>
          <PostText text={plan.reply.text} />
          <p className={s.sign}>
            <span className="serif">{plan.reply.by ?? 'A host'}</span>
            <time className="small" dateTime={plan.reply.at}>
              {formatDay(plan.reply.at)}
            </time>
          </p>
        </section>
      )}
    </div>
  );
}
