import s from './TemplateList.module.css';

/** A template as lists show it. The server fills it in, so no template's text comes to the browser with it. */
export interface TemplateSummary {
  readonly href: string;
  readonly kind: string;
  readonly title: string;
  readonly summary: string;
  /** Its module, for the library index: "Module 2 · Packages a client can compare". */
  readonly module: string;
}

/** Templates as ruled rows: kind, title and what each is for. The library index also names each one's module. */
export function TemplateList({ items, withModule = false }: { items: readonly TemplateSummary[]; withModule?: boolean }) {
  return (
    <ul className={s.templates}>
      {items.map((r) => (
        <li key={r.href}>
          <a href={r.href}>
            <span className={`label ${s.kind}`}>{r.kind}</span>
            <span className={s.what}>
              <span className={s.title}>{r.title}</span>
              <span className="small">{r.summary}</span>
              {withModule && <span className={`small ${s.where}`}>{r.module}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
