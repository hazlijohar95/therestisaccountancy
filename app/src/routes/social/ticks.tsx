import { createFileRoute } from '@tanstack/react-router';
import { TICK_SOURCES, TRACKS, trackNames } from '../../../../src/data/social.ts';
import { socialTitle } from '../../lib/title.ts';

const RULES = [
  ['Credentials, not advice.', 'A tick says the claim is true. It says nothing about whether a post is right.'],
  ['Checked every year.', 'Memberships and licences lapse. We re-check before each one expires.'],
  ['Lapsed shows in red.', 'A lapsed tick is struck through, not hidden. People can still post.'],
  ['Exact status.', 'Student, Affiliate, Member, Fellow. We never round up.'],
  ['Our marks only.', 'Bodies own their logos. We write the name and draw our own tick.'],
  ['Nominated is not public.', 'A nomination stays private until the person claims it. They can remove it.'],
  ['We keep less.', 'We store the result, not your documents. We never ask for an IC number.'],
  ['Report anything.', 'Wrong claim, fake account, or you want off the List. One button on every profile.'],
] as const;

export const Route = createFileRoute('/social/ticks')({
  staticData: { section: 'verify' },
  head: () => ({ meta: [...socialTitle('What a tick means'), { name: 'description', content: 'One seal, many ticks. Every mark says how we know a claim is true.' }] }),
  component: Ticks,
});

function Ticks() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="kicker">What a tick means</p>
          <h1 className="title">One seal. Many ticks.</h1>
          <p className="lead">Like a tickmark legend on a working paper. Every mark says how we know.</p>
        </div>
      </div>
      <section className="big-seal card" aria-labelledby="seal-title">
        <svg className="seal" aria-hidden="true">
          <use href="#seal" />
        </svg>
        <div>
          <h2 className="head" id="seal-title">
            The seal sits next to a name.
          </h2>
          <p>It appears once an account is proven and one more claim is ticked. The flair says where they are in the profession.</p>
          <div className="chips">
            {TRACKS.map((track) => (
              <span key={track} className="flair" data-track={track}>
                {trackNames[track]}
              </span>
            ))}
          </div>
        </div>
      </section>
      <section className="section" aria-labelledby="legend-title">
        <header>
          <h2 className="head" id="legend-title">
            The tickmark legend
          </h2>
        </header>
        <div className="legend">
          {Object.values(TICK_SOURCES).map((source) => (
            <div key={source.glyph} className="card">
              <span className="tick" data-state={source.glyph === 't-self' ? 'self' : 'ticked'}>
                <svg aria-hidden="true">
                  <use href={`#${source.glyph}`} />
                </svg>
              </span>
              <h3>{source.name}</h3>
              <p className="small">{source.means}</p>
            </div>
          ))}
          <div className="card">
            <span className="tick" data-state="lapsed">
              <svg aria-hidden="true">
                <use href="#t-register" />
              </svg>
            </span>
            <h3>Lapsed</h3>
            <p className="small">Was ticked. Not renewed. Struck in red until it is.</p>
          </div>
        </div>
      </section>
      <section className="section" aria-labelledby="rules-title">
        <header>
          <h2 className="head" id="rules-title">
            The rules
          </h2>
        </header>
        <div className="rules">
          {RULES.map(([rule, detail]) => (
            <div key={rule}>
              <h3>{rule}</h3>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
