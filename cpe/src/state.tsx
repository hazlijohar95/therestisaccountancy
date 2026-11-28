import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import type { Graded, HeardReport, LegacyImport, ReviewAnswer, Session, Sitting } from "./domain/api.ts";
import { emptyState, type AppState, type CourseProgress, type LoggedEntry, type MemberProfile } from "./domain/progress.ts";
import type { Course, Show } from "./domain/types.ts";

/** Where the prototype kept everything, in this browser. Read once after sign-in, brought into the account, then removed. */
const LEGACY_KEY = "tria-cpe:v1";

type Loading = { status: "loading" } | { status: "error"; message: string };

interface Store {
  session: Session | Loading;
  catalogue: { shows: readonly Show[]; courses: readonly Course[] } | null;
  state: AppState;
}

export interface Actions {
  /** Sends what the player heard. The server's accepted ranges come back and replace the course's progress. */
  reportHeard: (report: HeardReport, keepalive?: boolean) => Promise<void>;
  answerReview: (course: Course, checkpoint: number, pick: number) => Promise<ReviewAnswer>;
  sit: (course: Course) => Promise<Sitting>;
  submit: (course: Course, sittingId: string, picks: (number | null)[]) => Promise<Graded>;
  setName: (name: string) => Promise<void>;
  setProfile: (profile: MemberProfile) => Promise<void>;
  /** `declared` puts back the portal tick of an entry restored after removal. */
  log: (entry: Omit<LoggedEntry, "id" | "source">, declared?: boolean) => Promise<void>;
  unlog: (id: string) => Promise<void>;
  /** Ticks or unticks an entry as entered in the MIA portal. */
  setDeclared: (id: string, declared: boolean) => Promise<void>;
}

const StoreContext = createContext<Store>({ session: { status: "loading" }, catalogue: null, state: emptyState });
const ActionsContext = createContext<Actions | null>(null);

/** The prototype's record, shaped for the server's import. Anything unreadable is left out. */
function readLegacy(courses: readonly Course[]): LegacyImport | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { logged: [], certificates: [], positions: [] };
  }
  if (typeof parsed !== "object" || parsed === null) return { logged: [], certificates: [], positions: [] };
  const o = Object.fromEntries(Object.entries(parsed));
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.flatMap((x) => (typeof x === "object" && x !== null ? [Object.fromEntries(Object.entries(x))] : [])) : []);
  const progress = typeof o.progress === "object" && o.progress !== null ? Object.entries(o.progress) : [];
  return {
    ...(typeof o.learner === "string" ? { learner: o.learner } : {}),
    logged: arr(o.logged).map((e) => ({ id: String(e.id), date: String(e.date), title: String(e.title), provider: String(e.provider), field: String(e.field), hours: Number(e.hours) })),
    certificates: arr(o.certificates).flatMap((c) => {
      const course = courses.find((x) => x.id === c.courseId);
      if (!course) return [];
      return [{ id: String(c.id), courseId: course.id, issuedAt: String(c.issuedAt), title: course.title, provider: course.show.title, field: course.field, hours: course.credits }];
    }),
    positions: progress.flatMap(([courseId, p]) => (typeof p === "object" && p !== null && "position" in p && typeof p.position === "number" ? [{ courseId, position: p.position }] : [])),
  };
}

export function StateProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(() => ({ session: { status: "loading" }, catalogue: null, state: emptyState }));
  const setState = useCallback((state: AppState) => setStore((s) => ({ ...s, state })), []);
  const setProgress = useCallback(
    (courseId: string, p: CourseProgress) => setStore((s) => ({ ...s, state: { ...s.state, progress: { ...s.state.progress, [courseId]: p } } })),
    [],
  );

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [session, catalogue] = await Promise.all([api("GET /api/session"), api("GET /api/catalogue")]);
        let state = session.status === "member" ? session.state : emptyState;
        const legacy = session.status === "member" ? readLegacy(catalogue.courses) : null;
        if (legacy) {
          state = await api("POST /api/import", { body: legacy });
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {
            // Storage blocked: the import is keyed by the old ids, so running it again adds nothing.
          }
        }
        if (live) setStore({ session, catalogue, state });
      } catch (error) {
        if (live) setStore((s) => ({ ...s, session: { status: "error", message: error instanceof Error ? error.message : "CPE could not load." } }));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const actions = useMemo<Actions>(
    () => ({
      reportHeard: async (report, keepalive = false) => {
        const p = await api("POST /api/heard", { body: report, keepalive });
        setProgress(report.courseId, p);
      },
      answerReview: async (course, checkpoint, pick) => {
        const answer = await api("POST /api/review", { body: { courseId: course.id, version: course.version, checkpoint, pick } });
        if (answer.correct) setProgress(course.id, answer.progress);
        return answer;
      },
      sit: (course) => api("POST /api/sittings", { body: { courseId: course.id, version: course.version } }),
      submit: async (course, sittingId, picks) => {
        const graded = await api("POST /api/sittings/:id", { params: { id: sittingId }, body: { courseId: course.id, version: course.version, picks } });
        setState(graded.state);
        return graded;
      },
      setName: async (name) => setState(await api("PUT /api/name", { body: { name } })),
      setProfile: async (profile) => setState(await api("PUT /api/profile", { body: { profile } })),
      log: async (entry, declared) => setState(await api("POST /api/logged", { body: declared ? { ...entry, declared } : entry })),
      unlog: async (id) => setState(await api("DELETE /api/logged/:id", { params: { id } })),
      setDeclared: async (id, declared) => setState(await api("PUT /api/declared/:id", { params: { id }, body: { declared } })),
    }),
    [setProgress, setState],
  );

  return (
    <StoreContext.Provider value={store}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StoreContext.Provider>
  );
}

export const useSession = () => useContext(StoreContext).session;
export const useAppState = () => useContext(StoreContext).state;

const noCourses: readonly Course[] = [];
const noShows: readonly Show[] = [];

/** The published courses this listener sees: each on the version they are part-way through, or the newest. */
export function useCatalogue() {
  const catalogue = useContext(StoreContext).catalogue;
  const courses = catalogue?.courses ?? noCourses;
  return useMemo(
    () => ({ loaded: catalogue !== null, shows: catalogue?.shows ?? noShows, courses, courseById: (id: string) => courses.find((c) => c.id === id) }),
    [catalogue, courses],
  );
}

export function useActions(): Actions {
  const a = useContext(ActionsContext);
  if (!a) throw new Error("useActions outside StateProvider");
  return a;
}
