# 🎤 Karaoke Teleprompter

Letras en tiempo real sincronizadas con cualquier canción — detecta automáticamente qué suena y despliega las letras como teleprompter de karaoke.

## Stack
- **Next.js 15** — frontend + API routes
- **ACRCloud** — reconocimiento de canción (1000 req/mes gratis)
- **LRCLIB** — letras sincronizadas (gratis, sin auth)
- **Zustand** — estado global
- **FastAPI** — microservicio Python para reconocimiento

---

## Setup rápido

### 1. Clonar e instalar Next.js

```bash
npm install
```

### 2. Configurar ACRCloud (GRATIS)

**ACRCloud** te da 1000 reconocimientos/mes gratis — suficiente para uso personal.

1. Ve a https://www.acrcloud.com/ y crea una cuenta gratuita
2. Crea un nuevo proyecto llamado "Karaoke App"
3. Ve a la sección de credenciales y copia:
   - **Host** (ej: `identify-us-west-2.acrcloud.com`)
   - **Access Key**
   - **Access Secret`

4. Configura las credenciales en el servicio Python:

```bash
cd python-service
cp .env.example .env
# Edita .env y agrega tus credenciales de ACRCloud
```

### 3. Instalar dependencias Python

```bash
cd python-service
pip install -r requirements.txt
```

### 4. Variables de entorno

El archivo `.env.local` ya viene configurado para desarrollo local.

### 5. Correr en desarrollo

**Terminal 1 — Python service:**
```bash
cd python-service
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Next.js:**
```bash
npm run dev
```

O con un solo comando (requiere `concurrently`):
```bash
npm run dev:all
```

Abre http://localhost:3000

---

## Cómo funciona

```
Micrófono (8s) → /api/recognize → ACRCloud API
                                        ↓
                                título + artista + timecode
                                        ↓
                                     LRCLIB API
                                        ↓
                                líneas LRC con timestamps
                                        ↓
                               SyncEngine (rAF + offset)
                                        ↓
                               Teleprompter en tiempo real
```

1. Presiona el botón del micrófono
2. La app graba 8 segundos de audio
3. ACRCloud identifica la canción y devuelve en qué segundo va
4. LRCLIB devuelve las letras con timestamps por línea
5. El teleprompter salta directo al punto correcto
6. Cada 20 segundos re-detecta (para manejar cambios de canción en mixes)

---

## APIs utilizadas (GRATIS)

### ACRCloud
- **Precio**: 1000 requests/mes gratis
- **Registro**: https://www.acrcloud.com/
- **Tiempo de setup**: ~5 minutos
- **Precisión**: Excelente (mismo motor que Shazam)
- **Soporte**: MP3, WAV, FLAC, OGG, M4A, WebM, y más

### LRCLIB
- **Precio**: 100% gratis, sin autenticación
- **API**: https://lrclib.net/docs
- **Formato**: Letras sincronizadas en formato LRC
- **Cobertura**: Excelente para música popular en inglés, español, etc.

---

## Despliegue en producción

### Opción A: Vercel (Next.js) + Railway (Python)

1. Deploy de la carpeta `python-service/` en Railway (usa el Dockerfile)
2. Deploy del proyecto en Vercel
3. Agregar en Vercel: `PYTHON_SERVICE_URL=https://tu-app.railway.app`
4. Agregar en Railway las variables de entorno de ACRCloud

### Opción B: Docker Compose

```yaml
version: "3.9"
services:
  python:
    build: ./python-service
    ports: ["8000:8000"]
    environment:
      - ACR_HOST=identify-us-west-2.acrcloud.com
      - ACR_ACCESS_KEY=tu_key
      - ACR_ACCESS_SECRET=tu_secret
  nextjs:
    build: .
    ports: ["3000:3000"]
    environment:
      PYTHON_SERVICE_URL: http://python:8000
    depends_on: [python]
```

---

## Ajustes configurables

En `hooks/useKaraokeStore.ts`:
- `detectionInterval` — segundos entre re-detecciones (default: 20)

En `hooks/useAudioCapture.ts`:
- `recordSeconds` — duración del snippet enviado a ACRCloud (default: 8)

---

## Troubleshooting

### "No se detectó canción"
- Aumenta el volumen de la música
- Reduce el ruido ambiente
- Asegúrate de que ACRCloud esté configurado correctamente
- Verifica con `GET /providers` qué proveedores están activos

### "Permiso de micrófono denegado"
- Permite el acceso al micrófono en tu navegador
- En Chrome: click en el icono de candado → Permisos → Micrófono

### Error de conexión
- Verifica que el servicio Python esté corriendo en puerto 8000
- Revisa las variables de entorno en `.env.local`

---

## Estructura del proyecto

```
karaoke-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/recognize/route.ts    ← proxy a Python
├── components/
│   ├── KaraokeOrchestrator.tsx   ← lógica principal
│   └── KaraokeTeleprompter.tsx   ← UI
├── hooks/
│   ├── useAudioCapture.ts        ← Web Audio API
│   ├── useSyncEngine.ts          ← rAF loop
│   └── useKaraokeStore.ts        ← Zustand store
├── lib/
│   ├── lrclib.ts                 ← cliente LRCLIB
│   ├── lrcParser.ts              ← parser formato LRC
│   └── types.ts                  ← TypeScript types
└── python-service/
    ├── main.py                   ← FastAPI + ACRCloud
    ├── .env.example              ← ejemplo de config
    ├── requirements.txt
    └── Dockerfile
```

## 🎯 Roadmap
- [ ] Support for custom LRC files
- [ ] Offline mode
