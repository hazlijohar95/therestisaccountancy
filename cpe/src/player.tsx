import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { courseById } from "./domain/courses.ts";
import { progressOf } from "./domain/progress.ts";
import type { Course } from "./domain/types.ts";
import { useAppState, useDispatch } from "./state.tsx";

export const RATES = [1, 1.25, 1.5, 1.75, 2] as const;
export type Rate = (typeof RATES)[number];

interface Player {
  course: Course | null;
  time: number;
  playing: boolean;
  rate: Rate;
  /** A review checkpoint the listener has reached and not yet answered. */
  pending: number | null;
  play: (course: Course, at?: number) => void;
  toggle: () => void;
  seek: (t: number) => void;
  setRate: (r: Rate) => void;
  clearPending: () => void;
}

const PlayerContext = createContext<Player | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const audio = useRef<HTMLAudioElement | null>(null);
  const last = useRef<number | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState<Rate>(1);
  const [pending, setPending] = useState<number | null>(null);
  const course = courseId ? (courseById(courseId) ?? null) : null;

  const answered = course ? progressOf(state, course.id).checkpoints : [];
  const answeredRef = useRef(answered);
  answeredRef.current = answered;

  useEffect(() => {
    const el = new Audio();
    el.preload = "auto";
    audio.current = el;
    return () => el.pause();
  }, []);

  useEffect(() => {
    const el = audio.current;
    if (!el || !course) return;
    const onTime = () => {
      const t = el.currentTime;
      const prev = last.current;
      last.current = t;
      setTime(t);
      // The media element's own played ranges are the evidence: seeks never add to them.
      const ranges: [number, number][] = [];
      for (let i = 0; i < el.played.length; i++) ranges.push([el.played.start(i), el.played.end(i)]);
      dispatch({ type: "heard", courseId: course.id, ranges, at: t });
      if (prev === null || t <= prev || t - prev > 1.5 * el.playbackRate) return;
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
      dispatch({ type: "position", courseId: course.id, at: el.currentTime });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
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
  }, [course, dispatch]);

  const play = useCallback(
    (next: Course, at?: number) => {
      const el = audio.current;
      if (!el) return;
      if (courseId !== next.id) {
        el.src = next.audio;
        el.playbackRate = rate;
        const resume = at ?? progressOf(state, next.id).position;
        el.currentTime = resume < next.duration - 1 ? resume : 0;
        last.current = el.currentTime;
        setTime(el.currentTime);
        setCourseId(next.id);
        setPending(null);
      } else if (at !== undefined) {
        el.currentTime = at;
      }
      void el.play();
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: next.title, artist: next.show.title, album: "CPE" });
      }
    },
    [courseId, rate, state],
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
