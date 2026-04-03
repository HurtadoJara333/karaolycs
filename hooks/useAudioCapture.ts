// hooks/useAudioCapture.ts
"use client";
import { useRef, useCallback, useState } from "react";

interface UseAudioCaptureOptions {
  recordSeconds?: number;       // cuántos segundos grabar por detección (default: 8)
  onAudioReady: (blob: Blob, captureStartTime: number) => void;
  onRecordingStart?: (startTime: number) => void;
}

export function useAudioCapture({
  recordSeconds = 8,
  onAudioReady,
  onRecordingStart,
}: UseAudioCaptureOptions) {
  const streamRef    = useRef<MediaStream | null>(null);
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const getMimeType = (): string => {
    // Preferir webm/opus (mejor soporte cross-browser para MediaRecorder)
    const preferred = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    return preferred.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  };

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      setHasPermission(true);
      return true;
    } catch (err) {
      console.error("[AudioCapture] Permission denied:", err);
      setHasPermission(false);
      return false;
    }
  }, []);

  /**
   * Graba `recordSeconds` segundos del micrófono y llama onAudioReady
   * con el Blob resultante en formato webm/opus.
   */
  const captureSnippet = useCallback(async (): Promise<void> => {
    if (!streamRef.current) {
      const ok = await requestPermission();
      if (!ok) return;
    }

    return new Promise((resolve) => {
      const stream = streamRef.current!;
      const mimeType = getMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;
      chunksRef.current = [];

      // Registrar cuando empieza la grabacion
      const captureStartTime = performance.now();
      onRecordingStart?.(captureStartTime);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        onAudioReady(blob, captureStartTime);
        resolve();
      };

      recorder.start();

      // Detener automáticamente después de recordSeconds
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, recordSeconds * 1000);
    });
  }, [recordSeconds, onAudioReady, onRecordingStart, requestPermission]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setHasPermission(null);
  }, []);

  return {
    captureSnippet,
    requestPermission,
    stopStream,
    hasPermission,
  };
}
