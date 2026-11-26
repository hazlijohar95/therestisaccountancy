import { formatHours } from "../domain/courses.ts";
import { ledgerLines, standing } from "../domain/ledger.ts";
import { phaseOf, type Phase } from "../domain/progress.ts";
import { Link } from "../router.tsx";
import { useAppState, useCatalogue } from "../state.tsx";
import { Cover } from "./Cover.tsx";
import { Check, Home, Ledger, Search } from "./Icons.tsx";
import { Logo } from "./Logo.tsx";
import { Ring } from "./Ring.tsx";

const NAV = [
  { href: "/home", label: "Home", Icon: Home },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/ledger", label: "Ledger", Icon: Ledger },
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
  const s = standing(ledgerLines(state), state.requirement, new Date());
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
        <Ring slices={[{ value: s.total, tone: "var(--cpe)" }]} total={state.requirement.target} size={44} stroke={5} />
        <span>
          <strong>{formatHours(s.total)}h</strong>
          <span className="muted"> of {formatHours(state.requirement.target)}h</span>
        </span>
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
