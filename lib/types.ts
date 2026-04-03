// lib/types.ts

export interface LyricLine {
  t: number;       // timestamp in seconds
  text: string;
}

export interface SongInfo {
  title: string;
  artist: string;
  timecode: number;  // offset seconds — where in the song we are RIGHT NOW
  detectedAt: number; // performance.now() when detection completed
  coverUrl?: string | null;
}

export interface LyricsResult {
  song: SongInfo;
  lines: LyricLine[];
}

export interface RecognizeResponse {
  success: boolean;
  song?: SongInfo;
  error?: string;
}

export interface LRCLibResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  syncedLyrics: string | null;  // formato LRC con timestamps
  plainLyrics: string | null;
}

export type AppStatus =
  | "idle"
  | "listening"    // grabando audio del mic
  | "detecting"    // enviando a Shazam
  | "fetching"     // buscando letra en LRCLIB
  | "playing"      // teleprompter activo
  | "no_lyrics"    // canción detectada pero sin letra sincronizada
  | "error";
