// lib/lrclib.ts
import { LRCLibResponse, LyricLine } from "./types";
import { parseLRC } from "./lrcParser";

const LRCLIB_BASE = "https://lrclib.net/api";

// Cache en memoria para la sesión (evita re-fetches del mismo track)
const lyricsCache = new Map<string, LyricLine[] | null>();

function cacheKey(title: string, artist: string) {
  return `${title.toLowerCase()}::${artist.toLowerCase()}`;
}

/**
 * Busca letras sincronizadas en LRCLIB.
 * Devuelve array de LyricLine o null si no hay letra sincronizada.
 *
 * Strategy:
 * 1. Intenta búsqueda exacta por título + artista
 * 2. Si falla, intenta búsqueda fuzzy (solo título)
 */
export async function fetchSyncedLyrics(
  title: string,
  artist: string
): Promise<LyricLine[] | null> {
  const key = cacheKey(title, artist);

  // Cache hit
  if (lyricsCache.has(key)) {
    return lyricsCache.get(key) ?? null;
  }

  try {
    // 1. Búsqueda exacta
    const exact = await fetchExact(title, artist);
    if (exact) {
      lyricsCache.set(key, exact);
      return exact;
    }

    // 2. Búsqueda fuzzy como fallback
    const fuzzy = await fetchFuzzy(title, artist);
    lyricsCache.set(key, fuzzy);
    return fuzzy;

  } catch (err) {
    console.error("[LRCLIB] Error fetching lyrics:", err);
    lyricsCache.set(key, null);
    return null;
  }
}

async function fetchExact(title: string, artist: string): Promise<LyricLine[] | null> {
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
  });

  const res = await fetch(`${LRCLIB_BASE}/get?${params}`, {
    headers: { "Lrclib-Client": "karaoke-teleprompter/1.0" },
    next: { revalidate: 3600 }, // Next.js cache 1h
  });

  if (!res.ok) return null;

  const data: LRCLibResponse = await res.json();
  return extractLines(data);
}

async function fetchFuzzy(title: string, artist: string): Promise<LyricLine[] | null> {
  const params = new URLSearchParams({
    q: `${title} ${artist}`,
  });

  const res = await fetch(`${LRCLIB_BASE}/search?${params}`, {
    headers: { "Lrclib-Client": "karaoke-teleprompter/1.0" },
  });

  if (!res.ok) return null;

  const results: LRCLibResponse[] = await res.json();

  // Tomar el primer resultado que tenga letra sincronizada
  const match = results.find((r) => r.syncedLyrics);
  if (!match) return null;

  return extractLines(match);
}

function extractLines(data: LRCLibResponse): LyricLine[] | null {
  if (!data.syncedLyrics) return null;
  const lines = parseLRC(data.syncedLyrics);
  return lines.length > 0 ? lines : null;
}
