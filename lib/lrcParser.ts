// lib/lrcParser.ts
import { LyricLine } from "./types";

/**
 * Parsea formato LRC estándar a array de {t, text}
 *
 * Formato LRC:
 *   [00:27.93]Listen to the wind blow
 *   [00:31.22]Watch the sun rise
 *   [00:35.01]
 *
 * También maneja multi-timestamp:
 *   [00:27.93][01:14.20]Repeated chorus line
 */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timestampRegex = /\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/g;

  for (const raw of lrc.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Extraer todos los timestamps de la línea (puede haber múltiples)
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    timestampRegex.lastIndex = 0;

    while ((match = timestampRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      timestamps.push(minutes * 60 + seconds);
    }

    if (timestamps.length === 0) continue;

    // El texto es lo que queda después del último [timestamp]
    const lastBracket = trimmed.lastIndexOf("]");
    const text = lastBracket >= 0 ? trimmed.slice(lastBracket + 1).trim() : "";

    // Cada timestamp genera una línea (para coros repetidos)
    for (const t of timestamps) {
      lines.push({ t, text });
    }
  }

  // Ordenar por tiempo
  return lines.sort((a, b) => a.t - b.t);
}

/**
 * Encuentra el índice de la línea activa dado un elapsed time
 */
export function findActiveIndex(lines: LyricLine[], elapsed: number): number {
  if (lines.length === 0) return 0;
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (elapsed >= lines[i].t) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

/**
 * Calcula el progreso (0-1) dentro de la línea actual
 * útil para animaciones word-by-word en el futuro
 */
export function lineProgress(lines: LyricLine[], elapsed: number, activeIdx: number): number {
  const current = lines[activeIdx];
  const next = lines[activeIdx + 1];
  if (!current || !next) return 0;
  const duration = next.t - current.t;
  if (duration <= 0) return 1;
  return Math.min((elapsed - current.t) / duration, 1);
}
