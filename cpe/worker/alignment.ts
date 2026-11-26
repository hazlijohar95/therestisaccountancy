import type { Timing } from "../src/domain/types.ts";

/**
 * Segment timings come from one of two places, behind one shape: the start of each transcript segment, in seconds.
 * The Studio's manual timing editor produces them in the browser; an Aligner produces them on the server from the
 * audio and the transcript. With no aligner configured, the Studio offers the manual editor only.
 */
export interface Aligner {
  readonly name: string;
  align(audio: Blob, segments: readonly string[], duration: number): Promise<Timing>;
}

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/forced-alignment";

export interface AlignedWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const normalise = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const tokens = (text: string) => text.split(/\s+/).map(normalise).filter(Boolean);

/**
 * Where each segment starts, from words aligned against the whole transcript. Words are matched in order: each
 * segment's first word is looked for around where the previous segment's words ran out, so a word the aligner split
 * or dropped costs a little accuracy, not the rest of the transcript. Ends are the next segment's start.
 */
export function segmentStarts(segments: readonly string[], words: readonly AlignedWord[], duration: number): Timing {
  const aligned = words.map((w) => ({ ...w, key: normalise(w.text) })).filter((w) => w.key);
  const starts: number[] = [];
  let at = 0;
  let last = -1;
  for (const text of segments) {
    const own = tokens(text);
    const first = own[0];
    let found = -1;
    if (first !== undefined) {
      // A few words of slack behind the expected place, in case the aligner dropped some from the segment before.
      for (let i = Math.max(last + 1, at - 3); i < Math.min(aligned.length, at + 40); i++) {
        if (aligned[i]!.key === first) {
          found = i;
          break;
        }
      }
    }
    const index = found >= 0 ? found : Math.min(at, aligned.length - 1);
    const previous = starts[starts.length - 1] ?? 0;
    starts.push(Math.max(previous, aligned[index]?.start ?? previous));
    if (found >= 0) last = found;
    at = (found >= 0 ? found : at) + own.length;
  }
  return {
    duration,
    segments: starts.map((start, i) => ({ start: round(start), end: round(Math.min(duration, starts[i + 1] ?? duration)) })),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

const isWord = (v: unknown): v is AlignedWord =>
  typeof v === "object" && v !== null && "text" in v && typeof v.text === "string" && "start" in v && typeof v.start === "number" && "end" in v && typeof v.end === "number";

/** ElevenLabs forced alignment: POST the audio as `file` and the transcript as `text`, multipart, key in xi-api-key. */
export function elevenLabs(apiKey: string): Aligner {
  return {
    name: "ElevenLabs forced alignment",
    async align(audio, segments, duration) {
      const form = new FormData();
      form.set("file", audio, "audio");
      form.set("text", segments.join("\n"));
      const res = await fetch(ELEVENLABS_URL, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
      if (!res.ok) throw new Error(`ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body: unknown = await res.json();
      const words = typeof body === "object" && body !== null && "words" in body && Array.isArray(body.words) ? body.words.filter(isWord) : [];
      if (!words.length) throw new Error("ElevenLabs returned no aligned words.");
      return segmentStarts(segments, words, duration);
    },
  };
}

export const alignerFor = (env: { ELEVENLABS_API_KEY?: string }): Aligner | null => (env.ELEVENLABS_API_KEY ? elevenLabs(env.ELEVENLABS_API_KEY) : null);
