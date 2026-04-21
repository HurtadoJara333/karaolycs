"use client";
// components/KaraokeOrchestrator.tsx
import { useCallback, useEffect, useRef } from "react";
import { useKaraokeStore } from "@/hooks/useKaraokeStore";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { fetchSyncedLyrics } from "@/lib/lrclib";
import { RecognizeResponse } from "@/lib/types";
import KaraokeTeleprompter from "./KaraokeTeleprompter";

export default function KaraokeOrchestrator() {
  const {
    setStatus,
    currentSong, setCurrentSong,
    setLines,
    detectionInterval,
    setIsDetecting,
    setError,
    reset,
    setRecordingDuration,
    setCaptureStartTime,
    addDetectionDelay,
    setLyricsSearchDelay,
    getCurrentTimecode,
    setCoverUrl,
  } = useKaraokeStore();

  const { startSync, pauseSync } = useSyncEngine();
  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunningRef      = useRef(false);
  const isDetectingRef    = useRef(false); // evita llamadas solapadas

  // ─── Programar siguiente detección ────────────────────────────────────────
  const scheduleNextDetection = useCallback(() => {
    if (!isRunningRef.current) return;
    if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);

    detectionTimerRef.current = setTimeout(async () => {
      if (!isRunningRef.current || isDetectingRef.current) return;
      setStatus("listening");
      await captureSnippet();
    }, detectionInterval * 1000);
  // captureSnippet se define abajo — se agrega en el dep array tras declararlo
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionInterval, setStatus]);

  // ─── Pipeline de detección ─────────────────────────────────────────────────
  const runDetection = useCallback(async (audioBlob: Blob, captureStartTime: number) => {
    if (isDetectingRef.current) return; // evitar solapamiento
    isDetectingRef.current = true;
    setIsDetecting(true);
    setStatus("detecting");
    setCaptureStartTime(captureStartTime);
    setRecordingDuration(8000);

    try {
      const detectionStart = performance.now();
      const form = new FormData();
      form.append("audio", audioBlob, "snippet.webm");

      const res  = await fetch("/api/recognize", { method: "POST", body: form });
      const data: RecognizeResponse = await res.json();

      addDetectionDelay(performance.now() - detectionStart);

      if (!data.success || !data.song) {
        setStatus("listening");
        return; // scheduleNextDetection se llama en finally
      }

      const { song } = data;
      const coverUrlFromResponse = (data.song as any).cover_url ?? song?.coverUrl ?? null;
      setCoverUrl(coverUrlFromResponse);

      // ¿Misma canción?
      const isSameSong =
        currentSong?.title === song.title &&
        currentSong?.artist === song.artist;

      if (isSameSong) {
        const lines = useKaraokeStore.getState().lines;
        if (lines.length > 0) {
          startSync(lines, getCurrentTimecode(song.timecode));
          setCurrentSong(song);
          return;
        }
      }

      // Buscar letras
      setStatus("fetching");
      setCurrentSong(song);

      const lyricsStart = performance.now();
      const lines = await fetchSyncedLyrics(song.title, song.artist);
      setLyricsSearchDelay(performance.now() - lyricsStart);

      if (!lines) {
        setStatus("no_lyrics");
        return;
      }

      setLines(lines);
      startSync(lines, getCurrentTimecode(song.timecode));

    } catch (err) {
      console.error("[Orchestrator] Error:", err);
      setError("Error de conexión — reintentando…");
      setStatus("error");
    } finally {
      isDetectingRef.current = false;
      setIsDetecting(false);
      scheduleNextDetection(); // UNA sola vez, siempre al final
    }
  }, [currentSong, startSync, setStatus, setIsDetecting, setCurrentSong,
      setLines, setError, setCaptureStartTime, setRecordingDuration,
      addDetectionDelay, setLyricsSearchDelay, getCurrentTimecode,
      setCoverUrl, scheduleNextDetection]);

  // ─── Audio capture ─────────────────────────────────────────────────────────
  const { captureSnippet, requestPermission, stopStream, hasPermission } =
    useAudioCapture({
      recordSeconds: 8,
      onAudioReady: runDetection,
      onRecordingStart: (startTime) => setCaptureStartTime(startTime),
    });

  // ─── Start / Stop ──────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    const ok = await requestPermission();
    if (!ok) { setError("Permiso de micrófono denegado"); return; }
    isRunningRef.current = true;
    isDetectingRef.current = false;
    setStatus("listening");
    await captureSnippet();
  }, [requestPermission, captureSnippet, setStatus, setError]);

  const stopListening = useCallback(() => {
    isRunningRef.current = false;
    isDetectingRef.current = false;
    if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
    pauseSync();
    stopStream();
    reset();
  }, [pauseSync, stopStream, reset]);

  useEffect(() => () => {
    isRunningRef.current = false;
    if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
    stopStream();
  }, [stopStream]);

  return (
    <KaraokeTeleprompter
      onStart={startListening}
      onStop={stopListening}
      hasPermission={hasPermission}
    />
  );
}
