import { Button } from "@base-ui/react/button";
import { Copy } from "../../components/Icons.tsx";
import type { MytDate } from "../../domain/calendar.ts";
import { hours, type LedgerLine } from "../../domain/ledger.ts";
import { toasts as toast } from "../../toasts.ts";
import { PortalTick } from "./parts.tsx";

/** Day first, 27/11/2026: the usual order in Malaysia. The format MIA's portal takes is not confirmed. */
const portalDate = (date: MytDate) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

function CopyField({ label, value }: { label: string; value: string }) {
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => toast.add({ title: `${label} copied`, description: value }),
      () => toast.add({ title: "Could not copy", description: "Select the text and copy it instead." }),
    );
  return (
    <Button className="copyfield" onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}: ${value}`} title={value}>
      <span className="copyfield__label">{label}</span>
      <span className="copyfield__value">{value}</span>
      <Copy width={16} height={16} className="copyfield__icon" />
    </Button>
  );
}

/** The structured entries of the year not yet in MIA's portal, each with the four fields the portal asks for. */
export function Declare({ lines, year, open, onDeclared }: { lines: readonly LedgerLine[]; year: number; open: boolean; onDeclared: (id: string, declared: boolean) => void }) {
  return (
    <section className="shelf declare" data-test="declare">
      <h2 className="label">Declare to MIA</h2>
      <p className="declare__lead">
        {open ? `Enter each of these in MIA's member portal by 31 December ${year}, then tick it.` : `MIA's portal for ${year} closed on 31 December ${year}. Tick the ones you entered.`} Press a field to copy it.
      </p>
      <ul className="declare__list">
        {lines.map((l) => (
          <li key={l.id} className="declare__item">
            <div className="declare__fields">
              <CopyField label="Event date" value={portalDate(l.date)} />
              <CopyField label="Title" value={l.title} />
              <CopyField label="Organiser" value={l.organiser} />
              <CopyField label="Duration (hours)" value={hours(l.minutes)} />
            </div>
            <PortalTick checked={false} onChange={(checked) => onDeclared(l.id, checked)} title={l.title} labelled />
          </li>
        ))}
      </ul>
    </section>
  );
}
