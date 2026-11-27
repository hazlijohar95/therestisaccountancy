import { Badge } from '../ui/Badge.tsx';
import { Icon } from '../ui/Icon.tsx';
import { List, Row } from '../ui/List.tsx';

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
    <List>
      {items.map((r) => (
        <Row
          key={r.href}
          lead={<Icon name="file" />}
          title={<a href={r.href}>{r.title}</a>}
          meta={
            <>
              <Badge>{r.kind}</Badge>
              {withModule && <span>{r.module}</span>}
            </>
          }
        >
          <p className="small">{r.summary}</p>
        </Row>
      ))}
    </List>
  );
}
