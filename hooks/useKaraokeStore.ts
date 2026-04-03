// hooks/useKaraokeStore.ts
import { create } from "zustand";
import { AppStatus, LyricLine, SongInfo } from "@/lib/types";

interface KaraokeState {
  // Status
  status: AppStatus;
  setStatus: (s: AppStatus) => void;

  // Song
  currentSong: SongInfo | null;
  setCurrentSong: (s: SongInfo | null) => void;
  coverUrl: string | null;
  setCoverUrl: (url: string | null) => void;

  // Lyrics
  lines: LyricLine[];
  setLines: (l: LyricLine[]) => void;

  // Playback
  elapsed: number;
  setElapsed: (e: number) => void;

  activeIdx: number;
  setActiveIdx: (i: number) => void;

  // Detection loop
  isDetecting: boolean;
  setIsDetecting: (v: boolean) => void;

  detectionInterval: number; // seconds between detections
  setDetectionInterval: (n: number) => void;

  // Time tracking para sincronizacion precisa
  recordingDuration: number; // cuanto dura cada grabacion
  setRecordingDuration: (n: number) => void;
  
  captureStartTime: number; // performance.now() cuando empezo la grabacion
  setCaptureStartTime: (t: number) => void;
  
  detectionDelay: number; // delay acumulado de deteccion
  addDetectionDelay: (ms: number) => void;
  
  lyricsSearchDelay: number; // delay de busqueda de letras
  setLyricsSearchDelay: (ms: number) => void;

  // Error
  errorMessage: string | null;
  setError: (msg: string | null) => void;

  // Reset todo
  reset: () => void;
  
  // Calcular timecode real actual
  getCurrentTimecode: (songTimecode: number) => number;
}

export const useKaraokeStore = create<KaraokeState>((set, get) => ({
  status: "idle",
  setStatus: (status) => set({ status }),

  currentSong: null,
  setCurrentSong: (currentSong) => set({ currentSong }),

  coverUrl: null,
  setCoverUrl: (url) => set({ coverUrl: url }),

  lines: [],
  setLines: (lines) => set({ lines }),

  elapsed: 0,
  setElapsed: (elapsed) => set({ elapsed }),

  activeIdx: 0,
  setActiveIdx: (activeIdx) => set({ activeIdx }),

  isDetecting: false,
  setIsDetecting: (isDetecting) => set({ isDetecting }),

  detectionInterval: 20,
  setDetectionInterval: (detectionInterval) => set({ detectionInterval }),

  recordingDuration: 8000, // 8 segundos en ms
  setRecordingDuration: (n) => set({ recordingDuration: n }),
  
  captureStartTime: 0,
  setCaptureStartTime: (t) => set({ captureStartTime: t }),
  
  detectionDelay: 0,
  addDetectionDelay: (ms) => set((state) => ({ detectionDelay: state.detectionDelay + ms })),
  
  lyricsSearchDelay: 0,
  setLyricsSearchDelay: (ms) => set({ lyricsSearchDelay: ms }),

  errorMessage: null,
  setError: (errorMessage) => set({ errorMessage }),

  reset: () =>
    set({
      status: "idle",
      currentSong: null,
      lines: [],
      elapsed: 0,
      activeIdx: 0,
      isDetecting: false,
      errorMessage: null,
      recordingDuration: 8000,
      captureStartTime: 0,
      detectionDelay: 0,
      lyricsSearchDelay: 0,
      coverUrl: null,
    }),

  // Calcular donde esta la cancion AHORA basado en el timecode de ACRCloud
  getCurrentTimecode: (songTimecode: number) => {
    const state = get();
    const now = performance.now();
    
    // Tiempo transcurrido desde que empezo la grabacion
    const elapsedSinceCapture = (now - state.captureStartTime) / 1000;
    
    // El timecode de ACRCloud dice donde estaba la cancion AL FINAL de la grabacion
    // Asi que el timecode real actual es:
    // songTimecode + tiempo_transcurrido_desde_fin_grabacion
    // = songTimecode + elapsedSinceCapture - recordingDuration
    // + 1.5s de compensacion por delay del microfono/audio
    const COMPENSATION_MS = 1.5;
    const currentTimecode = songTimecode + elapsedSinceCapture - (state.recordingDuration / 1000) + COMPENSATION_MS;
    
    return currentTimecode;
  },
}));
