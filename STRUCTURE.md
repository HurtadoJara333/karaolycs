# karaoke-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       └── recognize/
│           └── route.ts          # Next.js API route → llama al microservicio Python
├── components/
│   ├── KaraokeTeleprompter.tsx   # UI principal (ya hecho)
│   ├── AudioCapture.tsx          # Captura micrófono → envía a /api/recognize
│   └── LyricsEngine.tsx          # Fetch LRCLIB + sync engine
├── hooks/
│   ├── useAudioCapture.ts        # Web Audio API hook
│   ├── useSyncEngine.ts          # rAF loop + offset logic
│   └── useKaraokeStore.ts        # Zustand store global
├── lib/
│   ├── lrclib.ts                 # Cliente LRCLIB
│   ├── lrcParser.ts              # Parsea formato LRC → [{t, text}]
│   └── types.ts                  # TypeScript types
├── python-service/
│   ├── main.py                   # FastAPI server
│   ├── requirements.txt
│   └── Dockerfile
└── .env.local
