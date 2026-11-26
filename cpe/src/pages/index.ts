import { lazy } from "react";

/** One loader per route chunk. Calling a loader again returns the cached module. */
const load = {
  landing: () => import("./Landing.tsx"),
  home: () => import("./Home.tsx"),
  search: () => import("./Search.tsx"),
  ledger: () => import("./Ledger.tsx"),
  show: () => import("./Show.tsx"),
  course: () => import("./CoursePage.tsx"),
  assessment: () => import("./Assessment.tsx"),
  certificate: () => import("./Certificate.tsx"),
  playerBar: () => import("../components/PlayerBar.tsx"),
  checkpoint: () => import("../components/CheckpointCard.tsx"),
  toasts: () => import("../components/Feedback.tsx"),
};

export const Landing = lazy(() => load.landing().then((m) => ({ default: m.Landing })));
export const Home = lazy(() => load.home().then((m) => ({ default: m.Home })));
export const Search = lazy(() => load.search().then((m) => ({ default: m.Search })));
export const Ledger = lazy(() => load.ledger().then((m) => ({ default: m.Ledger })));
export const ShowPage = lazy(() => load.show().then((m) => ({ default: m.ShowPage })));
export const CoursePage = lazy(() => load.course().then((m) => ({ default: m.CoursePage })));
export const Assessment = lazy(() => load.assessment().then((m) => ({ default: m.Assessment })));
export const CertificatePage = lazy(() => load.certificate().then((m) => ({ default: m.CertificatePage })));
export const PlayerBar = lazy(() => load.playerBar().then((m) => ({ default: m.PlayerBar })));
export const ToastLayer = lazy(() => load.toasts().then((m) => ({ default: m.ToastLayer })));
export const CheckpointCard = lazy(() => load.checkpoint().then((m) => ({ default: m.CheckpointCard })));

/** Warm every chunk once the first screen has painted, so later navigation never waits on the network. */
export function prefetchWhenIdle() {
  const run = () => Object.values(load).forEach((f) => void f());
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
