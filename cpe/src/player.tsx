import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { progressOf } from "./domain/progress.ts";
import { merge, seconds, type Range, type Rate } from "./domain/rules.ts";
import type { Course } from "./domain/types.ts";
import { useActions, useAppState, useSession } from "./state.tsx";

export { RATES, type Rate } from "./domain/rules.ts";

/** How often the player tells the server what was heard while there is anything new to tell. */
const REPORT_MS = 5000;

interface Player {
  course: Course | null;
  time: number;
  playing: boolean;
  rate: Rate;
  /** A review checkpoint the listener has reached and not yet answered. */
  pending: number | null;
  /** A preview plays a Studio draft: nothing is reported and review questions do not pause it. */
  play: (course: Course, at?: number, options?: { preview?: boolean }) => void;
  toggle: () => void;
  seek: (t: number) => void;
  setRate: (r: Rate) => void;
  clearPending: () => void;
}

const PlayerContext = createContext<Player | null>(null);

/** The media element's own played ranges: seeks never add to them, so they are the evidence of listening. */
function playedRanges(el: HTMLAudioElement): Range[] {
  const out: [number, number][] = [];
  for (let i = 0; i < el.played.length; i++) out.push([el.played.start(i), el.played.end(i)]);
  return merge(out);
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  const session = useSession();
  const actions = useActions();
  const audio = useRef<HTMLAudioElement | null>(null);
  const last = useRef<number | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [preview, setPreview] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState<Rate>(1);
  const [pending, setPending] = useState<number | null>(null);
  const courseId = course?.id ?? null;
  const member = session.status === "member" && !preview;

  const progress = course ? progressOf(state, course) : null;
  const answeredRef = useRef<readonly number[]>([]);
  answeredRef.current = progress?.checkpoints ?? [];
  const acceptedRef = useRef<readonly Range[]>([]);
  acceptedRef.current = progress?.ranges ?? [];

  useEffect(() => {
    const el = new Audio();
    el.preload = "auto";
    audio.current = el;
    return () => el.pause();
  }, []);

  /*
   * Reports go to the server, which keeps only what real time allows. The player keeps sending while anything it
   * played is not yet accepted, so audio heard faster than the server's budget is counted a little later, not lost.
   */
  const lastSent = useRef({ heard: -1, position: -1 });
  const sending = useRef(false);
  const report = useCallback(
    (force = false, keepalive = false) => {
      const el = audio.current;
      if (!el || !course || !member || (sending.current && !keepalive)) return;
      const ranges = playedRanges(el);
      const heard = seconds(ranges);
      const position = Math.round(el.currentTime * 10) / 10;
      const behind = heard > seconds(acceptedRef.current) + 0.5;
      const moved = heard !== lastSent.current.heard || position !== lastSent.current.position;
      if (!force && !behind && !moved) return;
      lastSent.current = { heard, position };
      sending.current = true;
      actions
        .reportHeard({ courseId: course.id, version: course.version, ranges, position }, keepalive)
        .catch(() => {
          // Offline or signed out: the next report carries the same ranges, since they are cumulative.
        })
        .finally(() => {
          sending.current = false;
        });
    },
    [course, member, actions],
  );
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!course || !member) return;
    const id = setInterval(() => reportRef.current(), REPORT_MS);
    const flush = () => reportRef.current(true, true);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [course, member]);

  useEffect(() => {
    const el = audio.current;
    if (!el || !course) return;
    const onTime = () => {
      const t = el.currentTime;
      const prev = last.current;
      last.current = t;
      setTime(t);
      if (preview || prev === null || t <= prev || t - prev > 1.5 * el.playbackRate) return;
      const hit = course.checkpointTimes.findIndex((at, i) => !answeredRef.current.includes(i) && prev <= at && at <= t);
      if (hit >= 0) {
        const at = course.checkpointTimes[hit]!;
        el.pause();
        el.currentTime = at;
        last.current = at;
        setPending(hit);
      }
    };
    const onSeeking = () => {
      last.current = null;
      setTime(el.currentTime);
    };
    const onSeeked = () => {
      last.current = el.currentTime;
      reportRef.current();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      reportRef.current(true);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, [course, preview]);

  const play = useCallback(
    (next: Course, at?: number, options: { preview?: boolean } = {}) => {
      const el = audio.current;
      if (!el) return;
      const asPreview = options.preview ?? false;
      if (courseId !== next.id || course?.version !== next.version || preview !== asPreview) {
        reportRef.current(true);
        el.src = next.audio;
        el.playbackRate = rate;
        const resume = at ?? progressOf(state, next).position;
        el.currentTime = resume < next.duration - 1 ? resume : 0;
        last.current = el.currentTime;
        lastSent.current = { heard: -1, position: -1 };
        setTime(el.currentTime);
        setCourse(next);
        setPreview(asPreview);
        setPending(null);
      } else if (at !== undefined) {
        el.currentTime = at;
      }
      void el.play();
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: next.title, artist: next.show.title, album: "CPE" });
      }
    },
    [course, courseId, preview, rate, state],
  );

  const value = useMemo<Player>(
    () => ({
      course,
      time,
      playing,
      rate,
      pending,
      play,
      toggle: () => {
        const el = audio.current;
        if (!el || !course || pending !== null) return;
        if (el.paused) void el.play();
        else el.pause();
      },
      seek: (t) => {
        const el = audio.current;
        if (!el || !course) return;
        el.currentTime = Math.max(0, Math.min(course.duration, t));
      },
      setRate: (r) => {
        setRateState(r);
        if (audio.current) audio.current.playbackRate = r;
      },
      clearPending: () => {
        setPending(null);
        void audio.current?.play();
      },
    }),
    [course, time, playing, rate, pending, play],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error("usePlayer outside PlayerProvider");
  return p;
}
