import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loaded, step, type Gate, type GateEvent } from "./domain/gate.ts";
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
  const [course, setCourse] = useState<Course | null>(null);
  const [preview, setPreview] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState<Rate>(1);
  const [handsFree, setHandsFreeState] = useState(initialHandsFree);
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

  /*
   * Review questions: domain/gate.ts decides, this carries out what it returns. The ref holds the current gate so
   * events that arrive between renders (timeupdate fires several times a second) each see the one before.
   */
  const gateRef = useRef<Gate>(loaded(0));
  const [gate, setGate] = useState<Gate>(gateRef.current);
  const dispatch = useCallback((event: GateEvent) => {
    const { gate: after, effects } = step(gateRef.current, event);
    gateRef.current = after;
    setGate(after);
    const el = audio.current;
    if (!el) return;
    for (const effect of effects) {
      if (effect.type === "play") {
        void el.play();
      } else {
        el.pause();
        if (effect.seek !== undefined) el.currentTime = effect.seek;
      }
    }
  }, []);
  const reset = (at: number) => {
    gateRef.current = loaded(at);
    setGate(gateRef.current);
  };

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
      setTime(el.currentTime);
      dispatch({
        type: "time",
        to: el.currentTime,
        rate: el.playbackRate,
        checkpointTimes: course.checkpointTimes,
        answered: answeredRef.current,
        ask: askRef.current,
        // Hands-free, or playing in the background where nobody can answer: queue it and keep playing.
        defer: handsFreeRef.current || document.visibilityState === "hidden",
      });
    };
    const onSeeking = () => {
      dispatch({ type: "seeking" });
      setTime(el.currentTime);
    };
    const onSeeked = () => {
      dispatch({ type: "seeked", at: el.currentTime });
      reportRef.current();
    };
    const onPlay = () => {
      setPlaying(true);
      dispatch({ type: "playing" });
    };
    const onPause = () => {
      setPlaying(false);
      reportRef.current(true);
    };
    const onEnded = () => {
      onPause();
      dispatch({ type: "ended" });
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
  }, [course, preview, dispatch]);

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
        reset(el.currentTime);
        lastSent.current = { heard: -1, position: -1 };
        setTime(el.currentTime);
        setCourse(next);
        setPreview(asPreview);
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

  /*
   * Lock-screen and headset controls. A question that paused the episode cannot be answered from the lock screen, so
   * pressing play there queues it for later and plays on, rather than doing nothing.
   */
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
      ["play", () => dispatch({ type: "remote-play" })],
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
  }, [course, dispatch]);

  const value = useMemo<Player>(
    () => ({
      course,
      time,
      playing,
      rate,
      pending: gate.pending,
      play,
      toggle: () => {
        const el = audio.current;
        if (!el || !course || gate.pending !== null) return;
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
      clearPending: () => dispatch({ type: "answered" }),
      queued: gate.queued,
      handsFree,
      setHandsFree: (on) => {
        setHandsFreeState(on);
        try {
          localStorage.setItem(HANDS_FREE_KEY, on ? "1" : "0");
        } catch {
          // Storage blocked: the setting lasts for this visit.
        }
      },
      answerQueued: () => dispatch({ type: "answer-queued" }),
    }),
    [course, time, playing, rate, gate, play, dispatch, handsFree],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error("usePlayer outside PlayerProvider");
  return p;
}
