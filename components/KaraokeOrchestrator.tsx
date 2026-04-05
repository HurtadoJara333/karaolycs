"use client";
// components/KaraokeOrchestrator.tsx
//
// Componente raíz que conecta:
//   AudioCapture → /api/recognize → LRCLIB → SyncEngine → Teleprompter
//
import { useCallback, useEffect, useRef } from "react";
import { useKaraokeStore } from "@/hooks/useKaraokeStore";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { fetchSyncedLyrics } from "@/lib/lrclib";
import { RecognizeResponse } from "@/lib/types";
import KaraokeTeleprompter from "./KaraokeTeleprompter";

export default function KaraokeOrchestrator() {
  const {
    status, setStatus,
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

  // ─── Core detection pipeline ───────────────────────────────────────────────
  const runDetection = useCallback(async (audioBlob: Blob, captureStartTime: number) => {
    setIsDetecting(true);
    setStatus("detecting");
    
    const recordMs = 8000;
    const recordSeconds = 8;
    
    // Registrar cuando empezo la grabacion
    setCaptureStartTime(captureStartTime);
    setRecordingDuration(recordMs);

    try {
      // 1. Enviar audio a ACRCloud
      const detectionStart = performance.now();
      const form = new FormData();
      form.append("audio", audioBlob, "snippet.webm");

      const res  = await fetch("/api/recognize", { method: "POST", body: form });
      const data: RecognizeResponse = await res.json();
      
      // Acumular delay de deteccion
      const detectionDelay = performance.now() - detectionStart;
      addDetectionDelay(detectionDelay);

      if (!data.success || !data.song) {
        setStatus("listening");
        setIsDetecting(false);
        scheduleNextDetection();
        return;
      }

      // Extraer song y cover_url del JSON (puede venir como cover_url de Python)
      const { song } = data;
      const coverUrlFromResponse = (data.song as any).cover_url || song?.coverUrl || null;
      
      console.log("[Orchestrator] Cover desde API:", (data.song as any).cover_url);
      console.log("[Orchestrator] Cover extraido:", coverUrlFromResponse);

      // 2. Comprobar si es la misma canción
      const isSameSong =
        currentSong?.title === song.title &&
        currentSong?.artist === song.artist;

      if (isSameSong) {
        const lines = useKaraokeStore.getState().lines;
        if (lines.length > 0) {
          const realTimecode = getCurrentTimecode(song.timecode);
          console.log(`[Orchestrator] Same song - Timecode real: ${realTimecode.toFixed(2)}s`);
          startSync(lines, realTimecode);
          setCurrentSong(song);
          scheduleNextDetection();
          setIsDetecting(false);
          return;
        }
      }

      // 3. Buscar letra en LRCLIB
      setStatus("fetching");
      setCurrentSong(song);
      setCoverUrl(coverUrlFromResponse);
      
      const lyricsStart = performance.now();
      const lines = await fetchSyncedLyrics(song.title, song.artist);
      const lyricsDelay = performance.now() - lyricsStart;
      setLyricsSearchDelay(lyricsDelay);

      if (!lines) {
        setStatus("no_lyrics");
        setIsDetecting(false);
        scheduleNextDetection();
        return;
      }

      // 4. Calcular timecode real en este momento exacto
      const realTimecode = getCurrentTimecode(song.timecode);

      const now = performance.now();
      const totalElapsed = (now - captureStartTime) / 1000;

      console.log(`[Orchestrator] ======`);
      console.log(`[Orchestrator] Grabacion: ${recordSeconds}s`);
      console.log(`[Orchestrator] Delay ACRCloud: ${(detectionDelay / 1000).toFixed(2)}s`);
      console.log(`[Orchestrator] Delay LRCLIB: ${(lyricsDelay / 1000).toFixed(2)}s`);
      console.log(`[Orchestrator] Tiempo total desde inicio captura: ${totalElapsed.toFixed(2)}s`);
      console.log(`[Orchestrator] Timecode ACRCloud: ${song.timecode.toFixed(2)}s`);
      console.log(`[Orchestrator] Timecode real (AHORA): ${realTimecode.toFixed(2)}s`);
      console.log(`[Orchestrator] ======`);

      // 5. Arrancar teleprompter
      setLines(lines);
      startSync(lines, realTimecode);

    } catch (err) {
      console.error("[Orchestrator] Detection error:", err);
      setError("Error de conexion - reintentando…");
      setStatus("error");
    } finally {
      setIsDetecting(false);
      scheduleNextDetection();
    }
  }, [currentSong, startSync, setStatus, setIsDetecting, setCurrentSong, setLines, setError, setCaptureStartTime, setRecordingDuration, addDetectionDelay, setLyricsSearchDelay, getCurrentTimecode]);

  // ─── Audio capture ─────────────────────────────────────────────────────────
  const { captureSnippet, requestPermission, stopStream, hasPermission } =
    useAudioCapture({
      recordSeconds: 8,
      onAudioReady: runDetection,
      onRecordingStart: (startTime) => setCaptureStartTime(startTime),
    });

  // ─── Detection loop ─────────────────────────────────────────────────────────
  const scheduleNextDetection = useCallback(() => {
    if (!isRunningRef.current) return;

    detectionTimerRef.current = setTimeout(async () => {
      if (!isRunningRef.current) return;
      setStatus("listening");
      await captureSnippet();
    }, detectionInterval * 1000);
  }, [captureSnippet, detectionInterval, setStatus]);

  // ─── Start / Stop ───────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    const ok = await requestPermission();
    if (!ok) {
      setError("Permiso de micrófono denegado");
      return;
    }
    isRunningRef.current = true;
    setStatus("listening");
    await captureSnippet(); // primera detección inmediata
  }, [requestPermission, captureSnippet, setStatus, setError]);

  const stopListening = useCallback(() => {
    isRunningRef.current = false;
    if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
    pauseSync();
    stopStream();
    reset();
  }, [pauseSync, stopStream, reset]);

  // Cleanup on unmount
  useEffect(() => () => {
    isRunningRef.current = false;
    if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
    stopStream();
  }, [stopStream]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <KaraokeTeleprompter
      onStart={startListening}
      onStop={stopListening}
      hasPermission={hasPermission}
    />
  );
}
// TODO: Add cover art component
