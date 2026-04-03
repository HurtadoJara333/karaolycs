// hooks/useSyncEngine.ts
"use client";
import { useRef, useCallback, useEffect } from "react";
import { findActiveIndex } from "@/lib/lrcParser";
import { LyricLine } from "@/lib/types";
import { useKaraokeStore } from "./useKaraokeStore";

/**
 * Motor de sincronización:
 * - Recibe las líneas y el offset (timecode de Shazam)
 * - Corre un rAF loop que calcula elapsed = (now - startTime) + offset
 * - Actualiza activeIdx en el store global
 */
export function useSyncEngine() {
  const rafRef    = useRef<number | null>(null);
  const startRef  = useRef<number>(0);     // performance.now() cuando empezó
  const offsetRef = useRef<number>(0);     // timecode de Shazam en segundos
  const linesRef  = useRef<LyricLine[]>([]);

  const setElapsed   = useKaraokeStore((s) => s.setElapsed);
  const setActiveIdx = useKaraokeStore((s) => s.setActiveIdx);
  const setStatus    = useKaraokeStore((s) => s.setStatus);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const now = performance.now();
    const elapsed = (now - startRef.current) / 1000 + offsetRef.current;

    setElapsed(elapsed);
    setActiveIdx(findActiveIndex(linesRef.current, elapsed));

    // Auto-stop cuando llegamos al final + 5s de margen
    const lastLine = linesRef.current[linesRef.current.length - 1];
    if (lastLine && elapsed > lastLine.t + 8) {
      stopLoop();
      setStatus("idle");
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [setElapsed, setActiveIdx, setStatus, stopLoop]);

  /**
   * Arranca o reinicia el motor con nuevas líneas y offset.
   * Llamar esto cada vez que Shazam detecta una canción nueva
   * o el mismo track en diferente posición.
   */
  const startSync = useCallback(
    (lines: LyricLine[], timecodeSeconds: number) => {
      stopLoop();
      linesRef.current  = lines;
      offsetRef.current = timecodeSeconds;
      startRef.current  = performance.now();

      // Calcular activeIdx inicial antes del primer frame
      setElapsed(timecodeSeconds);
      setActiveIdx(findActiveIndex(lines, timecodeSeconds));

      setStatus("playing");
      rafRef.current = requestAnimationFrame(tick);
    },
    [tick, stopLoop, setElapsed, setActiveIdx, setStatus]
  );

  const pauseSync = useCallback(() => {
    stopLoop();
  }, [stopLoop]);

  // Cleanup on unmount
  useEffect(() => () => stopLoop(), [stopLoop]);

  return { startSync, pauseSync, stopLoop };
}
