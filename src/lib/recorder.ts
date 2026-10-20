/* Records a read from the microphone while Azure listens to the same stream (milestone 3 follow-up).
 *
 * One getUserMedia call, inside the tap on "Start reading", feeds both the Speech SDK (through setMicStream) and a
 * MediaRecorder, so the saved audio lines up with Azure's word offsets. Safari records audio/mp4, Chrome audio/webm. */

import { setMicStream } from "./azureRecognizer";

export interface Recording {
  blob: Blob;
  mime: string;
  seconds: number;
}

export interface ReadRecorder {
  /** Epoch ms when recording began, the clock each word time is measured on. */
  startedAtMs: number;
  /** Stop the microphone and resolve with the audio; null when nothing was captured. */
  stop(): Promise<Recording | null>;
}

const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function canRecord(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Open the microphone, hand the stream to the Azure recognizer, and start recording. Rejects when the microphone is
 * refused; the caller then listens without a recording.
 */
export async function startRecording(): Promise<ReadRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  setMicStream(stream);
  const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const startedAtMs = Date.now();
  rec.start(1000);
  let stopped: Promise<Recording | null> | null = null;
  return {
    startedAtMs,
    stop() {
      if (stopped) return stopped;
      stopped = new Promise<Recording | null>((resolve) => {
        const finish = () => {
          setMicStream(null);
          stream.getTracks().forEach((t) => t.stop());
          const type = rec.mimeType || mime || "audio/webm";
          const blob = new Blob(chunks, { type });
          resolve(blob.size > 0 ? { blob, mime: type.split(";")[0], seconds: Math.round((Date.now() - startedAtMs) / 100) / 10 } : null);
        };
        if (rec.state === "inactive") { finish(); return; }
        rec.onstop = finish;
        try { rec.stop(); } catch { finish(); }
        setTimeout(finish, 1500); // Safari sometimes never fires onstop
      });
      return stopped;
    },
  };
}
