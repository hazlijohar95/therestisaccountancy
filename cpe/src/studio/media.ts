import { api } from "../api.ts";

/** Bars in a waveform, the same count the sample courses were measured with. */
const BARS = 160;

/**
 * Duration and waveform peaks, measured in the browser: the Worker cannot run ffmpeg. The audio is decoded at 8 kHz
 * mono-equivalent, enough for loudness bars, so an hour-long episode stays within memory.
 */
export async function measure(file: Blob): Promise<{ duration: number; peaks: number[] }> {
  const ctx = new OfflineAudioContext(1, 1, 8000);
  const audio = await ctx.decodeAudioData(await file.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const size = Math.max(1, Math.floor(audio.length / BARS));
  const rms = Array.from({ length: BARS }, (_, b) => {
    let sum = 0;
    for (let i = b * size; i < Math.min(audio.length, (b + 1) * size); i++) {
      let v = 0;
      for (const ch of channels) v += ch[i] ?? 0;
      v /= channels.length;
      sum += v * v;
    }
    return Math.sqrt(sum / size);
  });
  const max = Math.max(...rms) || 1;
  return { duration: Math.round(audio.duration * 100) / 100, peaks: rms.map((v) => Math.round((v / max) * 100) / 100) };
}

/** Uploads audio to R2 through the Worker in parts, so a long file never has to go in one request. Returns its URL. */
export async function upload(courseId: string, file: File, onProgress: (share: number) => void): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const start = await api("POST /api/studio/uploads", { body: { courseId, ext } });
  const at = { params: { uploadId: start.uploadId }, query: { key: start.key } };
  const parts: { partNumber: number; etag: string }[] = [];
  try {
    const count = Math.max(1, Math.ceil(file.size / start.partSize));
    for (let n = 0; n < count; n++) {
      const chunk = file.slice(n * start.partSize, (n + 1) * start.partSize);
      parts.push(await api("PUT /api/studio/uploads/:uploadId/:part", { params: { ...at.params, part: String(n + 1) }, query: at.query, body: chunk }));
      onProgress((n + 1) / count);
    }
    const done = await api("POST /api/studio/uploads/:uploadId/complete", { params: at.params, body: { key: start.key, parts } });
    return done.url;
  } catch (error) {
    await api("DELETE /api/studio/uploads/:uploadId", at).catch(() => {});
    throw error;
  }
}
