// Renders every course script to narrated audio and records exact segment timings.
// Reruns skip courses whose script hash is unchanged.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scripts } from "../worker/seed/catalog.ts";

const root = new URL("..", import.meta.url).pathname;
const audioDir = join(root, "public/audio");
const timingsPath = join(root, "worker/seed/timings.json");
const GAP = 0.45;
const BARS = 160;
const voices: Record<string, string> = { Host: "Daniel", Guest: "Samantha" };
const voiceFor = (speaker: string) => {
  const voice = voices[speaker];
  if (!voice) throw new Error(`No voice for speaker "${speaker}"`);
  return voice;
};

interface Entry {
  hash: string;
  duration: number;
  segments: { start: number; end: number }[];
  peaks: number[];
}

mkdirSync(audioDir, { recursive: true });
const timings: Record<string, Entry> = existsSync(timingsPath)
  ? (JSON.parse(readFileSync(timingsPath, "utf8")) as Record<string, Entry>)
  : {};

const probe = (file: string): number =>
  Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      encoding: "utf8",
    }).trim(),
  );

for (const course of scripts) {
  const hash = createHash("sha1")
    .update(JSON.stringify([voices, GAP, course.segments]))
    .digest("hex");
  const out = join(audioDir, `${course.id}.m4a`);
  const cached = timings[course.id];
  if (cached?.hash === hash && existsSync(out)) {
    cached.peaks = peaks(out);
    console.log(`skip ${course.id}`);
    continue;
  }

  const work = mkdtempSync(join(tmpdir(), "cpe-audio-"));
  const silence = join(work, "gap.wav");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", String(GAP), silence]);

  const list: string[] = [];
  const segments: Entry["segments"] = [];
  let t = 0;
  course.segments.forEach((seg, i) => {
    const aiff = join(work, `s${i}.aiff`);
    const wav = join(work, `s${i}.wav`);
    execFileSync("say", ["-v", voiceFor(seg.speaker), "-r", "185", "-o", aiff, seg.text]);
    execFileSync("ffmpeg", ["-v", "error", "-i", aiff, "-ar", "22050", "-ac", "1", wav]);
    const d = probe(wav);
    if (!Number.isFinite(d) || d <= 0) throw new Error(`${course.id} segment ${i} rendered no audio`);
    segments.push({ start: round(t), end: round(t + d) });
    t += d + GAP;
    list.push(`file '${wav}'`, `file '${silence}'`);
  });

  const listFile = join(work, "list.txt");
  writeFileSync(listFile, list.join("\n"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "64k", out]);
  const entry: Entry = { hash, duration: round(probe(out)), segments, peaks: peaks(out) };
  timings[course.id] = entry;
  rmSync(work, { recursive: true, force: true });
  console.log(`built ${course.id} ${entry.duration}s`);
}

writeFileSync(timingsPath, JSON.stringify(timings, null, 2) + "\n");

/** RMS loudness in BARS buckets, normalised so the loudest bucket is 1. */
function peaks(file: string): number[] {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"], {
    maxBuffer: 1 << 28,
  });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const size = Math.floor(samples.length / BARS);
  const rms = Array.from({ length: BARS }, (_, b) => {
    let sum = 0;
    for (let i = b * size; i < (b + 1) * size; i++) {
      const v = samples[i] ?? 0;
      sum += v * v;
    }
    return Math.sqrt(sum / size);
  });
  const max = Math.max(...rms);
  return rms.map((v) => round(v / max));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
