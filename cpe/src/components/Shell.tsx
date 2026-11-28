import { mytDate, yearOf } from "../domain/calendar.ts";
import { hours, standingOf, structuredOf } from "../domain/ledger.ts";
import { phaseOf, type Phase } from "../domain/progress.ts";
import { Link } from "../router.tsx";
import { useAppState, useCatalogue, useSession } from "../state.tsx";
import { Cover } from "./Cover.tsx";
import { Check, Home, Ledger, Plus, Search } from "./Icons.tsx";
import { Logo } from "./Logo.tsx";
import { Ring } from "./Ring.tsx";

const NAV = [
  { href: "/home", label: "Home", Icon: Home },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/ledger", label: "My CPE", Icon: Ledger },
] as const;

export function statusLabel(phase: Phase): string {
  switch (phase.kind) {
    case "new":
      return "New";
    case "listening":
      return `${Math.floor(phase.heard * 100)}% heard`;
    case "ready":
      return "Assessment ready";
    case "certified":
      return "Earned";
  }
}

export function Rail({ path }: { path: string }) {
  const state = useAppState();
  const { courses } = useCatalogue();
  const session = useSession();
  const admin = session.status === "member" && session.member.role === "admin";
  const structured = structuredOf(standingOf(state, yearOf(mytDate(new Date()))));
  return (
    <aside className="rail" aria-label="Main">
      <Link href="/" className="rail__logo" aria-label="CPE home">
        <Logo />
      </Link>
      <nav className="rail__nav">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`navlink${path.startsWith(href) ? " navlink--on" : ""}`}
            aria-current={path.startsWith(href) ? "page" : undefined}
            data-test={`nav-${label.toLowerCase()}`}
          >
            <Icon width={22} height={22} />
            {label}
          </Link>
        ))}
        {admin && (
          <Link href="/studio" className={`navlink${path.startsWith("/studio") ? " navlink--on" : ""}`} aria-current={path.startsWith("/studio") ? "page" : undefined} data-test="nav-studio">
            <Plus width={22} height={22} />
            Studio
          </Link>
        )}
      </nav>
      <div className="rail__lib">
        <p className="eyebrow">Courses</p>
        <ul>
          {courses.map((c) => {
            const phase = phaseOf(state, c);
            return (
              <li key={c.id}>
                <Link href={`/course/${c.id}`} className={`librow${path === `/course/${c.id}` ? " librow--on" : ""}`}>
                  <Cover course={c} size="sm" />
                  <span className="librow__text">
                    <span className="librow__title">{c.title}</span>
                    <span className={`librow__meta${phase.kind === "certified" ? " is-earned" : ""}`}>
                      {phase.kind === "certified" && <Check width={12} height={12} />}
                      {statusLabel(phase)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <Link href="/ledger" className="rail__balance">
        <Ring slices={[{ value: structured ? Math.min(structured.have, structured.need) : 0, tone: "var(--cpe)" }]} total={structured?.need ?? 1} size={44} stroke={5} />
        {structured ? (
          <span>
            <strong>{hours(structured.have)} h</strong>
            <span className="muted"> of {hours(structured.need)} h structured</span>
          </span>
        ) : (
          <span className="muted">No hours asked this year</span>
        )}
      </Link>
    </aside>
  );
}

export function TabBar({ path }: { path: string }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={`tab${path.startsWith(href) ? " tab--on" : ""}`} aria-current={path.startsWith(href) ? "page" : undefined}>
          <Icon width={22} height={22} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
