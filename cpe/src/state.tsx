import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import { initialState, reduce, type Action, type AppState } from "./domain/progress.ts";

const KEY = "tria-cpe:v1";

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("progress" in parsed) || !("requirement" in parsed)) {
      return initialState;
    }
    return { ...initialState, ...(parsed as Partial<AppState>) };
  } catch {
    return initialState;
  }
}

const StateContext = createContext<AppState>(initialState);
const DispatchContext = createContext<Dispatch<Action>>(() => {});

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Private mode or full storage: progress lives for this tab only.
    }
  }, [state]);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export const useAppState = () => useContext(StateContext);
export const useDispatch = () => useContext(DispatchContext);
