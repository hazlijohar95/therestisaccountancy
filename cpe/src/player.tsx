import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { progressOf } from "./domain/progress.ts";
import { merge, seconds, type Range, type Rate } from "./domain/rules.ts";
import type { Course } from "./domain/types.ts";
import { useActions, useAppState, useSession } from "./state.tsx";

export { RATES, type Rate } from "./domain/rules.ts";

/** How often the player tells the server what was heard while there is anything new to tell. */
const REPORT_MS = 5000;

/** Hands-free is a setting of this device, so it lives in the browser. Phones start with it on. */
const HANDS_FREE_KEY = "tria-cpe:hands-free";
function initialHandsFree(): boolean {
  try {
    const saved = localStorage.getItem(HANDS_FREE_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // Storage blocked: fall back to the device's kind.
  }
  return matchMedia("(pointer: coarse)").matches;
}

interface Player {
  course: Course | null;
  time: number;
  playing: boolean;
  rate: Rate;
  /** The review question on screen now. */
  pending: number | null;
  /** Review questions reached but not yet answered, waiting for the end of the episode in hands-free mode. */
  queued: readonly number[];
  /** Review questions queue up instead of pausing the episode. Credit still needs every one answered. */
  handsFree: boolean;
  setHandsFree: (on: boolean) => void;
  /** Shows the first queued question now. */
  answerQueued: () => void;
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
  const [queued, setQueued] = useState<readonly number[]>([]);
  const [handsFree, setHandsFreeState] = useState(initialHandsFree);
  const [ended, setEnded] = useState(false);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  /** Only a member can answer review questions, so for anyone else (the landing page's samples) they never stop playback. */
  const askRef = useRef(false);
  const courseId = course?.id ?? null;
  const member = session.status === "member" && !preview;
  askRef.current = member;

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
      if (!askRef.current || prev === null || t <= prev || t - prev > 1.5 * el.playbackRate) return;
      const hit = course.checkpointTimes.findIndex((at, i) => !answeredRef.current.includes(i) && prev <= at && at <= t);
      if (hit < 0) return;
      // Hands-free, or playing in the background where nobody can answer: queue it and keep playing.
      if (handsFreeRef.current || document.visibilityState === "hidden") {
        setQueued((q) => (q.includes(hit) ? q : [...q, hit].sort((a, b) => a - b)));
        return;
      }
      const at = course.checkpointTimes[hit]!;
      el.pause();
      el.currentTime = at;
      last.current = at;
      setPending(hit);
    };
    const onSeeking = () => {
      last.current = null;
      setTime(el.currentTime);
    };
    const onSeeked = () => {
      last.current = el.currentTime;
      reportRef.current();
    };
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
    };
    const onPause = () => {
      setPlaying(false);
      reportRef.current(true);
    };
    const onEnded = () => {
      onPause();
      setEnded(true);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [course, preview]);

  const play = useCallback(
    (next: Course, at?: number, options: { preview?: boolean } = {}) => {
      const el = audio.current;
      if (!el) return;
      const asPreview = options.preview ?? false;
      if (courseId !== next.id || course?.version !== next.version || preview !== asPreview) {
        // The new source clears el.played, so this report is the last chance to send the old course's evidence.
        reportRef.current(true, true);
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
        setQueued([]);
        setEnded(false);
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

  /** Whether the question on screen came from a pause, so answering it should play on. Queued ones never resume. */
  const pausedFor = useRef<number | null>(null);
  useEffect(() => {
    pausedFor.current = pending !== null && !queued.includes(pending) ? pending : pausedFor.current;
  }, [pending, queued]);

  // At the end of the episode, queued questions come up one by one.
  useEffect(() => {
    if (ended && pending === null && queued.length > 0) setPending(queued[0]!);
  }, [ended, pending, queued]);

  const clearPending = useCallback(() => {
    const done = pending;
    const rest = queued.filter((q) => q !== done);
    setQueued(rest);
    if (done !== null && pausedFor.current === done) {
      pausedFor.current = null;
      setPending(null);
      void audio.current?.play();
      return;
    }
    // A queued question leads to the next one waiting, if any.
    setPending(rest.length > 0 ? rest[0]! : null);
  }, [pending, queued]);

  /*
   * Lock-screen and headset controls. A question that paused the episode cannot be answered from the lock screen, so
   * pressing play there queues it for later and plays on, rather than doing nothing.
   */
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const el = audio.current;
    if (!el || !course || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const setPosition = () => {
      if (!Number.isFinite(el.duration) || el.duration <= 0) return;
      try {
        ms.setPositionState({ duration: el.duration, position: Math.min(el.currentTime, el.duration), playbackRate: el.playbackRate });
      } catch {
        // Some browsers refuse a position state mid-seek; the next update sets it.
      }
    };
    const seekBy = (d: number) => {
      el.currentTime = Math.max(0, Math.min(course.duration, el.currentTime + d));
      setPosition();
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        "play",
        () => {
          const waiting = pendingRef.current;
          if (waiting !== null) {
            setQueued((q) => (q.includes(waiting) ? q : [...q, waiting].sort((a, b) => a - b)));
            pausedFor.current = null;
            setPending(null);
          }
          void el.play();
        },
      ],
      ["pause", () => el.pause()],
      ["seekbackward", (d) => seekBy(-(d.seekOffset ?? 15))],
      ["seekforward", (d) => seekBy(d.seekOffset ?? 15)],
      [
        "seekto",
        (d) => {
          if (d.seekTime === undefined) return;
          el.currentTime = Math.max(0, Math.min(course.duration, d.seekTime));
          setPosition();
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // An action this browser does not support.
      }
    }
    let lastSet = 0;
    const onTime = () => {
      if (Date.now() - lastSet < 1000) return;
      lastSet = Date.now();
      setPosition();
    };
    const onState = () => {
      ms.playbackState = el.paused ? "paused" : "playing";
      setPosition();
    };
    el.addEventListener("timeupdate", onTime);
    for (const e of ["play", "pause", "ratechange", "seeked", "loadedmetadata"]) el.addEventListener(e, onState);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      for (const e of ["play", "pause", "ratechange", "seeked", "loadedmetadata"]) el.removeEventListener(e, onState);
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // Unsupported action.
        }
      }
    };
  }, [course]);

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
      clearPending,
      queued,
      handsFree,
      setHandsFree: (on) => {
        setHandsFreeState(on);
        try {
          localStorage.setItem(HANDS_FREE_KEY, on ? "1" : "0");
        } catch {
          // Storage blocked: the setting lasts for this visit.
        }
      },
      answerQueued: () => {
        if (queued.length && pending === null) {
          audio.current?.pause();
          setPending(queued[0]!);
        }
      },
    }),
    [course, time, playing, rate, pending, play, clearPending, queued, handsFree],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error("usePlayer outside PlayerProvider");
  return p;
}
