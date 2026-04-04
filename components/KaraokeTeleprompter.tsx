"use client";
// components/KaraokeTeleprompter.tsx
import { useEffect, useRef } from "react";
import { useKaraokeStore } from "@/hooks/useKaraokeStore";

interface Props {
  onStart: () => void;
  onStop:  () => void;
  hasPermission: boolean | null;
}

const STATUS_LABEL: Record<string, string> = {
  idle:       "listo para escuchar",
  listening:  "● escuchando…",
  detecting:  "● detectando canción…",
  fetching:   "● buscando letra…",
  playing:    "● en vivo",
  no_lyrics:  "sin letra sincronizada",
  error:      "error — reintentando",
};

export default function KaraokeTeleprompter({ onStart, onStop, hasPermission }: Props) {
  const {
    status, currentSong, lines,
    elapsed, activeIdx, errorMessage,
    coverUrl,
  } = useKaraokeStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef    = useRef<HTMLDivElement>(null);

  const isActive = status === "playing" || status === "detecting" || status === "fetching";
  const maxT     = lines[lines.length - 1]?.t + 8 || 80;
  const pct      = lines.length ? Math.min((elapsed / maxT) * 100, 100) : 0;

  // Auto-scroll
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  return (
    <div className="karaoke-container">
      {/* Ambient glow general */}
      <div className="karaoke-glow" />

      {/* Progress bar */}
      <div className="karaoke-progress-bar">
        <div className="karaoke-progress-fill" style={{ width: pct + "%" }} />
      </div>

      {/* Header */}
      <header className="karaoke-header">
        <div className="karaoke-header-info">
          <div className="karaoke-status">{STATUS_LABEL[status] ?? status}</div>
          {currentSong ? (
            <>
              <div className="karaoke-title">{currentSong.title}</div>
              <div className="karaoke-artist">{currentSong.artist}</div>
            </>
          ) : (
            <div className="karaoke-waiting">
              {status === "idle" ? "esperando canción..." : "identificando..."}
            </div>
          )}
        </div>
        {status === "playing" && (
          <div className="karaoke-timer">
            {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
            {String(Math.floor(elapsed % 60)).padStart(2, "0")}
          </div>
        )}
      </header>

        {/* Contenido principal con Cover y Letras */}
      <main className="karaoke-main">
        {/* Cover Art - solo visible cuando hay URL */}
        <aside className={`karaoke-cover-sidebar ${coverUrl ? "karaoke-cover-visible" : ""}`}>
          <div className="karaoke-cover-container">
            <div className="karaoke-cover-glow" />
            <div className="karaoke-cover-wrapper">
              {coverUrl && (
                <img
                  className="karaoke-cover"
                  src={coverUrl}
                  alt="cover"
                />
              )}
            </div>
          </div>
        </aside>

        {/* Lyrics area */}
        <section className="karaoke-lyrics" ref={containerRef}>
          {/* Empty states */}
          {status === "idle" && (
            <div className="karaoke-empty-state">
              Presiona el micrófono y pon música
            </div>
          )}

          {(status === "listening" || status === "detecting" || status === "fetching") && lines.length === 0 && (
            <div className="karaoke-loading">
              <div className="karaoke-loading-text">{STATUS_LABEL[status]}</div>
            </div>
          )}

          {status === "no_lyrics" && (
            <div className="karaoke-empty-state">
              No se encontraron letras sincronizadas
            </div>
          )}

          {errorMessage && status === "error" && (
            <div className="karaoke-error">{errorMessage}</div>
          )}

          {/* Lyric lines */}
          {lines.map((line, i) => {
            const isActiveLine = i === activeIdx && status === "playing";
            const isPast       = i < activeIdx;
            const isNext       = i === activeIdx + 1;
            const isFar        = i > activeIdx + 3;

            if (!line.text) return <div key={i} className="karaoke-line-empty" />;

            return (
              <div
                key={i}
                ref={isActiveLine ? activeRef : null}
                className={`karaoke-line ${isActiveLine ? "karaoke-line-active" : ""} ${isPast ? "karaoke-line-past" : ""} ${isNext ? "karaoke-line-next" : ""} ${isFar ? "karaoke-line-far" : ""}`}
              >
                {line.text}
              </div>
            );
          })}
        </section>
      </main>

      {/* Bottom fade */}
      <div className="karaoke-fade-bottom" />

      {/* Controls */}
      <footer className="karaoke-controls">
        {hasPermission === false && (
          <div className="karaoke-permission-error">
            Permiso de micrófono requerido
          </div>
        )}

        <button
          className={`karaoke-button ${isActive ? "karaoke-button-stop" : "karaoke-button-start"}`}
          onClick={isActive ? onStop : onStart}
        >
          {isActive ? (
            <svg className="karaoke-button-icon" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="5" width="14" height="14" rx="2"/>
            </svg>
          ) : (
            <svg className="karaoke-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
          )}
        </button>
      </footer>

      <style>{`
        .karaoke-container {
          min-height: 100vh;
          background: #050508;
          display: flex;
          flex-direction: column;
          font-family: 'Georgia', 'Times New Roman', serif;
          color: #e8e0d0;
          overflow: hidden;
          position: relative;
        }

        .karaoke-glow {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          background: radial-gradient(ellipse 60% 40% at 50% 80%, rgba(180,100,255,0.07) 0%, transparent 70%);
        }

        .karaoke-progress-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          z-index: 30;
          background: rgba(255,255,255,0.06);
        }

        .karaoke-progress-fill {
          height: 100%;
          background: linear-gradient(to right, rgba(180,100,255,0.6), rgba(200,130,255,0.9));
          transition: width 0.3s linear;
          box-shadow: 0 0 8px rgba(180,100,255,0.6);
        }

        .karaoke-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 25;
          padding: 18px 32px;
          background: linear-gradient(to bottom, rgba(5,5,8,0.98) 70%, transparent);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        @media (min-width: 769px) {
          .karaoke-header {
            padding-left: 35vw;
          }
        }

        .karaoke-header-info {
          flex: 1;
          min-width: 0;
        }

        .karaoke-status {
          font-size: 11px;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          color: rgba(180,100,255,0.7);
          font-family: monospace;
          margin-bottom: 4px;
        }

        .karaoke-title {
          font-size: 19px;
          letter-spacing: 0.02em;
          color: #f0e8d8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .karaoke-artist {
          font-size: 13px;
          color: rgba(200,180,160,0.55);
          letter-spacing: 0.08em;
        }

        .karaoke-waiting {
          font-size: 16px;
          color: rgba(200,180,160,0.3);
          font-style: italic;
        }

        .karaoke-timer {
          font-family: monospace;
          font-size: 13px;
          color: rgba(200,180,160,0.4);
        }

        .karaoke-main {
          flex: 1;
          display: flex;
          position: relative;
          z-index: 10;
        }

        /* Desktop: Cover fijo a la izquierda */
        @media (min-width: 769px) {
          .karaoke-cover-sidebar {
            position: fixed;
            left: 20px;
            top: 50%;
            transform: translateY(-50%);
            width: 30vw;
            max-width: 320px;
            z-index: 15;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
          }

          .karaoke-cover-sidebar.karaoke-cover-visible {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }

          .karaoke-main {
            margin-left: 32vw;
          }
        }

        .karaoke-cover-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .karaoke-cover-glow {
          position: absolute;
          inset: -30px;
          background: radial-gradient(ellipse at center, rgba(180,100,255,0.5) 0%, rgba(180,100,255,0.15) 40%, transparent 70%);
          filter: blur(30px);
          animation: karaoke-pulse 3s ease-in-out infinite;
        }

        @keyframes karaoke-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }

        .karaoke-cover-wrapper {
          width: 28vw;
          height: 28vw;
          max-width: 280px;
          max-height: 280px;
          min-width: 140px;
          min-height: 140px;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 
            0 0 30px rgba(180,100,255,0.6),
            0 0 60px rgba(180,100,255,0.4),
            0 0 100px rgba(180,100,255,0.2),
            0 8px 32px rgba(0,0,0,0.8);
          position: relative;
          z-index: 1;
        }

        .karaoke-cover {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        /* Responsive - Móvil: Cover arriba fijo */
        @media (max-width: 768px) {
          .karaoke-main {
            flex-direction: column;
            margin-left: 0;
          }

          .karaoke-cover-sidebar {
            position: fixed;
            top: 90px;
            left: 50%;
            transform: translateX(-50%);
            width: auto;
            padding: 0;
            z-index: 15;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
          }

          .karaoke-cover-sidebar.karaoke-cover-visible {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }

          .karaoke-cover-wrapper {
            width: 35vw;
            height: 35vw;
            max-width: 140px;
            max-height: 140px;
            min-width: 100px;
            min-height: 100px;
            border-radius: 12px;
          }

          .karaoke-cover-glow {
            inset: -20px;
            filter: blur(20px);
          }

          .karaoke-lyrics {
            padding-top: 200px;
          }
        }

        .karaoke-lyrics {
          flex: 1;
          overflow-y: auto;
          padding-top: 100px;
          padding-bottom: 200px;
          padding-left: clamp(24px, 8vw, 120px);
          padding-right: clamp(24px, 8vw, 120px);
          scrollbar-width: none;
        }

        .karaoke-empty-state {
          text-align: center;
          padding-top: 20vh;
          color: rgba(200,180,160,0.2);
          font-size: 18px;
          font-style: italic;
        }

        .karaoke-loading {
          text-align: center;
          padding-top: 20vh;
        }

        .karaoke-loading-text {
          color: rgba(180,100,255,0.5);
          font-size: 15px;
          letter-spacing: 0.1em;
          font-family: monospace;
        }

        .karaoke-error {
          text-align: center;
          padding-top: 20vh;
          color: rgba(255,100,100,0.5);
          font-size: 14px;
          font-family: monospace;
        }

        .karaoke-line {
          font-size: clamp(14px, 2.2vw, 24px);
          line-height: 1.35;
          margin-bottom: 0.45em;
          letter-spacing: 0.02em;
          color: rgba(210,190,170,0.35);
          font-style: italic;
          user-select: none;
          transition: font-size 0.35s cubic-bezier(0.34,1.56,0.64,1), color 0.4s ease, text-shadow 0.4s ease, transform 0.4s ease;
        }

        .karaoke-line-active {
          font-size: clamp(28px, 5vw, 52px) !important;
          margin-bottom: 0.6em;
          color: #ffffff;
          letter-spacing: 0.01em;
          text-shadow: 0 0 40px rgba(200,140,255,0.5), 0 0 80px rgba(180,100,255,0.25);
          transform: translateX(0px);
        }

        .karaoke-line-past {
          color: rgba(200,180,160,0.18);
          transform: translateX(-6px);
        }

        .karaoke-line-next {
          font-size: clamp(18px, 3vw, 32px) !important;
          color: rgba(220,200,180,0.55);
          transform: translateX(4px);
        }

        .karaoke-line-far {
          color: rgba(200,180,160,0.12);
        }

        .karaoke-line-empty {
          height: 2.2em;
        }

        .karaoke-fade-bottom {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 220px;
          background: linear-gradient(to top, rgba(5,5,8,1) 40%, transparent);
          z-index: 15;
          pointer-events: none;
        }

        .karaoke-controls {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 20;
          padding: 0 32px 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
        }

        .karaoke-permission-error {
          color: rgba(255,100,100,0.6);
          font-size: 12px;
          font-family: monospace;
          margin-right: 8px;
        }

        .karaoke-button {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          border: 1px solid rgba(180,100,255,0.35);
          background: rgba(180,100,255,0.15);
          color: rgba(200,160,255,0.9);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(180,100,255,0.15);
          transition: all 0.2s ease;
        }

        .karaoke-button:hover {
          background: rgba(180,100,255,0.25);
          transform: scale(1.05);
        }

        .karaoke-button-stop {
          border: 1px solid rgba(255,100,100,0.3);
          background: rgba(255,60,60,0.1);
          color: rgba(255,120,120,0.9);
          box-shadow: 0 0 20px rgba(255,60,60,0.1);
        }

        .karaoke-button-icon {
          width: 22px;
          height: 22px;
        }

        ::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
