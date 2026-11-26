import s from './Signup.module.css';

/** The free newsletter's sign-up. A plain form to /newsletter/subscribe, so it works from static pages too. */
export function Signup({
  source,
  title = 'The newsletter, free.',
  lead = 'Essays, the podcast and the week’s practice news, by email. Free, whether or not you join the club.',
}: {
  source: 'footer' | 'home' | 'newsletter';
  title?: string;
  lead?: string;
}) {
  const id = `signup-${source}`;
  return (
    <form className={s.signup} method="POST" action="/newsletter/subscribe" aria-labelledby={id}>
      <div className={s.copy}>
        <h2 className="serif" id={id}>
          {title}
        </h2>
        <p>{lead}</p>
      </div>
      <div className={s.field}>
        <label className="small" htmlFor={`${id}-email`}>
          Email
        </label>
        <div className={s.row}>
          <input className={`input ${s.input}`} id={`${id}-email`} name="email" type="email" autoComplete="email" required />
          <input type="hidden" name="source" value={source} />
          <div className={s.trap} aria-hidden="true">
            <input name="trap" tabIndex={-1} autoComplete="off" />
          </div>
          <button className="btn" type="submit">
            Subscribe
          </button>
        </div>
      </div>
    </form>
  );
}
