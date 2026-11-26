import { Suspense, useEffect } from "react";
import { courseById } from "./domain/courses.ts";
import { shows } from "./content/catalog.ts";
import { Close } from "./components/Icons.tsx";
import { Logo } from "./components/Logo.tsx";
import { Rail, TabBar } from "./components/Shell.tsx";
import { usePlayer } from "./player.tsx";
import { Link, usePath } from "./router.tsx";
import { Assessment, CertificatePage, CheckpointCard, CoursePage, Home, Landing, Ledger, PlayerBar, prefetchWhenIdle, Search, ShowPage, ToastLayer } from "./pages/index.ts";
import { NotFound } from "./pages/NotFound.tsx";

const Pending = () => <div className="view" aria-busy="true" />;

type Route =
  | { page: "landing" }
  | { page: "home" }
  | { page: "search" }
  | { page: "ledger" }
  | { page: "show"; id: string }
  | { page: "course"; id: string }
  | { page: "assessment"; id: string }
  | { page: "certificate"; id: string }
  | { page: "missing" };

function route(pathname: string): Route {
  const [a, b, c] = pathname.split("/").filter(Boolean);
  if (!a) return { page: "landing" };
  if ((a === "home" || a === "library") && !b) return { page: "home" };
  if (a === "search" && !b) return { page: "search" };
  if (a === "ledger" && !b) return { page: "ledger" };
  if (a === "show" && b && !c) return { page: "show", id: b };
  if (a === "course" && b && !c) return { page: "course", id: b };
  if (a === "course" && b && c === "assessment") return { page: "assessment", id: b };
  if (a === "certificate" && b && !c) return { page: "certificate", id: b };
  return { page: "missing" };
}

function titleOf(r: Route): string {
  const course = "id" in r ? courseById(r.id)?.title : undefined;
  switch (r.page) {
    case "landing":
      return "CPE you can listen to";
    case "home":
      return "Home";
    case "search":
      return "Search";
    case "ledger":
      return "Ledger";
    case "show":
      return shows.find((s) => s.id === r.id)?.title ?? "Show";
    case "course":
      return course ?? "Course";
    case "assessment":
      return course ? `Assessment · ${course}` : "Assessment";
    case "certificate":
      return "Certificate";
    case "missing":
      return "Not found";
  }
}

export function App() {
  const full = usePath();
  const pathname = full.split("?")[0] ?? "/";
  const r = route(pathname);
  const title = titleOf(r);
  useEffect(() => {
    document.title = `${title} · CPE · The Rest Is Accountancy`;
  }, [title]);
  const player = usePlayer();
  useEffect(prefetchWhenIdle, []);
  // The question dialog and player bar only matter once something has played.
  const playing = player.course !== null;
  const questions = playing && (
    <Suspense fallback={null}>
      <CheckpointCard />
    </Suspense>
  );
  const overlays = (
    <>
      {questions}
      <Suspense fallback={null}>
        <ToastLayer />
      </Suspense>
    </>
  );

  if (r.page === "landing") {
    return (
      <>
        <Suspense fallback={null}>
          <Landing />
        </Suspense>
        {questions}
      </>
    );
  }

  if (r.page === "assessment" || r.page === "certificate") {
    const back = r.page === "assessment" ? `/course/${r.id}` : "/ledger";
    return (
      <div className="focus">
        <header className="focus__bar noprint">
          <Link href="/home" aria-label="CPE home">
            <Logo />
          </Link>
          <Link href={back} className="ghost-icon" aria-label="Close" data-test="close-focus">
            <Close />
          </Link>
        </header>
        <main tabIndex={-1}>
          <Suspense fallback={<Pending />}>
            {r.page === "assessment" ? <Assessment key={r.id} id={r.id} /> : <CertificatePage id={r.id} />}
          </Suspense>
        </main>
        {overlays}
      </div>
    );
  }

  const shownPath = r.page === "home" ? "/home" : pathname;
  return (
    <div className={`app${player.course ? " app--playing" : ""}`}>
      <Rail path={shownPath} />
      <header className="mobile-top noprint">
        <Link href="/home" aria-label="CPE home">
          <Logo />
        </Link>
      </header>
      <main className="main" tabIndex={-1}>
        <Suspense fallback={<Pending />}>
          {r.page === "home" && <Home />}
          {r.page === "search" && <Search />}
          {r.page === "ledger" && <Ledger />}
          {r.page === "show" && <ShowPage key={r.id} id={r.id} />}
          {r.page === "course" && <CoursePage key={r.id} id={r.id} />}
          {r.page === "missing" && <NotFound />}
        </Suspense>
      </main>
      {playing && (
        <Suspense fallback={null}>
          <PlayerBar />
        </Suspense>
      )}
      <TabBar path={shownPath} />
      {overlays}
    </div>
  );
}
