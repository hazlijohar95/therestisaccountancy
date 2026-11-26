import { planSections } from '../../../../src/data/plan.ts';
import { PostText } from './PostText.tsx';
import s from './PlanLetter.module.css';

/** A plan as the letter reads it: what the member wrote by section, and the host's answer once there is one. */
export interface Letter {
  readonly answers: Readonly<Partial<Record<string, string>>>;
  readonly reply: { readonly text: string; readonly by: string | null; readonly at: string; readonly day: string } | null;
}

const number = (i: number) => String(i + 1).padStart(2, '0');

/** A plan read as a letter: the member's sections in order, then the host's answer, set apart. */
export function PlanLetter({ plan, level = 2 }: { plan: Letter; level?: 2 | 3 | 4 }) {
  const Heading = `h${level}` as const;
  return (
    <div className={s.letter}>
      <ol className={s.sections}>
        {planSections.map((section, i) => {
          const answer = plan.answers[section.slug];
          return (
            <li className={s.section} key={section.slug}>
              <Heading className={s.heading}>
                <span className={`serif ${s.n}`} aria-hidden="true">
                  {number(i)}
                </span>
                {section.heading}
              </Heading>
              {answer ? <PostText text={answer} /> : <p className={`small ${s.blank}`}>Not written yet.</p>}
            </li>
          );
        })}
      </ol>
      {plan.reply && (
        <section className={`night ${s.answer}`} aria-label="The answer">
          <p className={`label ${s.top}`}>The answer</p>
          <PostText text={plan.reply.text} className={s.reply} />
          <p className={s.sign}>
            <span className="serif">{plan.reply.by ?? 'A host'}</span>
            <time className="small" dateTime={plan.reply.at}>
              {plan.reply.day}
            </time>
          </p>
        </section>
      )}
    </div>
  );
}
