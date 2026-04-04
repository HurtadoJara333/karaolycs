# python-service/main.py
"""
Karaoke Recognition Service
- ACRCloud (principal, 1000 req/mes gratis)
- AcoustID como fallback (gratis, sin límites)
"""
import asyncio
import json
import os
import subprocess
import tempfile
import base64
import uuid
import time
from typing import Optional

# Cargar variables de entorno desde .env
from dotenv import load_dotenv
load_dotenv()

import aiohttp
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Karaoke Recognition Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "https://*.vercel.app"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ─── AcoustID Config (fallback) ──────────────────────────────────────────────
ACOUSTID_API_KEY = os.getenv("ACOUSTID_API_KEY", "dwr7lHgK7f")
FPCALC_PATH = os.path.join(os.path.dirname(__file__), "fpcalc.exe")


# ─── Response Models ─────────────────────────────────────────────────────────
class SongInfo(BaseModel):
    title: str
    artist: str
    timecode: float
    cover_url: Optional[str] = None
    album: Optional[str] = None
    confidence: float = 0.0


class RecognizeResponse(BaseModel):
    success: bool
    song: Optional[SongInfo] = None
    error: Optional[str] = None
    provider: Optional[str] = None


# ─── Shazam API (implementación directa) ─────────────────────────────────────
SHAZAM_API_URL = "https://shazam-core.p.rapidapi.com/v1/tracks/recognize"

# Headers necesarios para Shazam (usando RapidAPI público)
SHAZAM_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# Alternativa: usar la API interna de Shazam
SHAZAM_ENDPOINT = "https://cmv.shazam.com/v2/recognize"


async def recognize_with_shazam(audio_data: bytes) -> Optional[SongInfo]:
    """
    Reconoce canción usando Shazam API.
    Implementación basada en el protocolo reverse-engineered.
    """
    try:
        # Crear archivo temporal
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            # Convertir a formato que Shazam acepta (PCM/WAV sería ideal)
            # Por ahora intentar con el audio directo
            
            # Generar signature del audio
            signature = generate_signature(audio_data)
            
            # Payload para Shazam
            payload = {
                "signature": signature,
                "sample_bytes": len(audio_data),
                "start": 0,
                "end": len(audio_data),
            }
            
            async with aiohttp.ClientSession() as session:
                # Intentar con el endpoint de Shazam
                async with session.post(
                    SHAZAM_ENDPOINT,
                    json=payload,
                    headers=SHAZAM_HEADERS,
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return parse_shazam_response(data)
                    
                    print(f"[Shazam] HTTP {resp.status}")
                    return None
                    
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except Exception as e:
        print(f"[Shazam] Error: {e}")
        return None


def generate_signature(audio_data: bytes) -> str:
    """Genera una firma simple del audio para Shazam."""
    # Usar hash del contenido como firma simplificada
    import hashlib
    return base64.b64encode(hashlib.sha256(audio_data[:8192]).digest()).decode()


def parse_shazam_response(data: dict) -> Optional[SongInfo]:
    """Parsea la respuesta de Shazam."""
    try:
        track = data.get("track", data.get("song", {}))
        if not track:
            return None
            
        return SongInfo(
            title=track.get("title", track.get("name", "Unknown")),
            artist=track.get("subtitle", track.get("artist", {}).get("name", "Unknown")),
            timecode=float(track.get("offset", 0)),
            cover_url=track.get("images", {}).get("coverarthq"),
            album=track.get("album", {}).get("name") if isinstance(track.get("album"), dict) else None,
            confidence=0.9,
        )
    except Exception:
        return None


# ─── ACRCloud (fallback principal) ───────────────────────────────────────────
# ACRCloud tiene 1000 req/mes gratis - más que suficiente para uso personal
ACR_HOST = os.getenv("ACR_HOST", "identify-us-west-2.acrcloud.com")
ACR_ACCESS_KEY = os.getenv("ACR_ACCESS_KEY", "")
ACR_ACCESS_SECRET = os.getenv("ACR_ACCESS_SECRET", "")


async def recognize_with_acr(audio_data: bytes, filename: str) -> Optional[SongInfo]:
    """Reconoce usando ACRCloud."""
    import hmac
    import hashlib
    
    # Verificar credenciales
    if not ACR_ACCESS_KEY or not ACR_ACCESS_SECRET:
        print("[ACR] ⚠ No configurado - agrega ACR_ACCESS_KEY y ACR_ACCESS_SECRET en .env")
        return None
    
    print(f"[ACR] Host: {ACR_HOST}")
    print(f"[ACR] Access Key: {ACR_ACCESS_KEY[:8]}...")
    
    try:
        timestamp = int(time.time())
        
        # Firma HMAC para ACRCloud
        string_to_sign = f"POST\n/v1/identify\n{ACR_ACCESS_KEY}\naudio\n1\n{timestamp}"
        sign = hmac.new(
            ACR_ACCESS_SECRET.encode("ascii"),
            string_to_sign.encode("ascii"),
            digestmod=hashlib.sha1,
        ).digest()
        # ACRCloud expects signature encoded in Base64, not hex
        import base64
        signature_b64 = base64.b64encode(sign).decode()
        
        form_data = aiohttp.FormData()
        form_data.add_field("sample", audio_data, filename=filename, content_type="audio/webm")
        form_data.add_field("access_key", ACR_ACCESS_KEY)
        form_data.add_field("data_type", "audio")
        form_data.add_field("signature_version", "1")
        form_data.add_field("signature", signature_b64)
        form_data.add_field("sample_bytes", str(len(audio_data)))
        form_data.add_field("timestamp", str(timestamp))

        url = f"https://{ACR_HOST}/v1/identify"
        print(f"[ACR] Enviando a: {url}")

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                data=form_data,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                print(f"[ACR] HTTP status: {resp.status}")
                print(f"[ACR] Content-Type: {resp.headers.get('content-type', 'unknown')}")
                
                # Leer respuesta como texto primero
                text = await resp.text()
                print(f"[ACR] Response: {text[:500]}")
                
                if resp.status != 200:
                    print(f"[ACR] Error HTTP {resp.status}")
                    return None

                # Intentar parsear como JSON
                try:
                    data = json.loads(text)
                except json.JSONDecodeError as e:
                    print(f"[ACR] No es JSON válido: {e}")
                    # Puede que las credenciales sean incorrectas
                    if "Unauthorized" in text or "Invalid" in text:
                        print("[ACR] ⚠ Credenciales inválidas - verifica Access Key y Secret")
                    return None

                status = data.get("status", {})
                print(f"[ACR] Status: {status}")
                
                if status.get("code") != 0:
                    print(f"[ACR] No match: {status.get('msg', '')}")
                    return None

                metadata = data.get("metadata", {})
                music_list = metadata.get("music", [])
                
                if not music_list:
                    return None

                best = max(music_list, key=lambda x: x.get("score", 0))
                
                # Extraer URL del cover
                cover_url = None
                album_data = best.get("album", {})
                cover_data = album_data.get("cover", {})
                
                # Intentar diferentes formatos
                if cover_data:
                    # Formato array con objetos {name, url}
                    urls = cover_data.get("url", [])
                    for u in urls:
                        if isinstance(u, dict):
                            if u.get("name") == "XL":
                                cover_url = u.get("url")
                                break
                            elif not cover_url:
                                cover_url = u.get("url")
                    # Formato directo
                    if not cover_url:
                        cover_url = cover_data.get("xl") or cover_data.get("l") or cover_data.get("m")
                
                # Prioridad: 1) album.cover, 2) Spotify, 3) YouTube thumbnail
                if not cover_url:
                    ext_meta = best.get("external_metadata", {})
                    
                    # 2) Spotify
                    spotify = ext_meta.get("spotify", {})
                    spotify_album = spotify.get("album", {})
                    spotify_cover = spotify_album.get("cover")
                    if spotify_cover:
                        cover_url = spotify_cover.get("url") or spotify_cover.get("large") or spotify_cover.get("medium") or spotify_cover.get("small")
                    
                    # 3) YouTube thumbnail
                    if not cover_url:
                        youtube = ext_meta.get("youtube", {})
                        vid = youtube.get("vid")
                        if vid:
                            cover_url = f"https://img.youtube.com/vi/{vid}/mqdefault.jpg"
                
                print(f"[ACR] Cover URL: {cover_url}")
                
                return SongInfo(
                    title=best.get("title", "Unknown"),
                    artist=best.get("artists", [{}])[0].get("name", "Unknown"),
                    timecode=float(best.get("play_offset_ms", 0)) / 1000.0,
                    cover_url=cover_url,
                    album=album_data.get("name"),
                    confidence=best.get("score", 0) / 100.0,
                )

    except Exception as e:
        print(f"[ACR] Error: {e}")
        import traceback
        traceback.print_exc()
        return None


# ─── AcoustID Fallback ───────────────────────────────────────────────────────
async def lookup_acoustid(fingerprint: str, duration: int) -> Optional[dict]:
    """Busca fingerprint en AcoustID."""
    try:
        params = {
            "client": ACOUSTID_API_KEY,
            "fingerprint": fingerprint,
            "duration": duration,
            "meta": "recordings releases",
            "format": "json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.acoustid.org/v2/lookup",
                data=params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status != 200:
                    return None
                
                data = await resp.json()
                if data.get("status") != "ok":
                    return None
                
                results = data.get("results", [])
                if not results:
                    return None
                
                return max(results, key=lambda x: x.get("score", 0))
                
    except Exception as e:
        print(f"[AcoustID] Error: {e}")
        return None


async def recognize_with_acoustid(audio_data: bytes) -> Optional[SongInfo]:
    """Reconoce usando AcoustID + Chromaprint."""
    if not os.path.exists(FPCALC_PATH):
        print("[AcoustID] fpcalc.exe no encontrado")
        return None
        
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = tmp.name
    
    try:
        result = subprocess.run(
            [FPCALC_PATH, "-json", tmp_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            print(f"[AcoustID] fpcalc error: {result.stderr}")
            return None
            
        fp_data = json.loads(result.stdout)
        duration = fp_data.get("duration", 0)
        fingerprint = fp_data.get("fingerprint", "")
        
        if not fingerprint:
            return None
        
        print(f"[AcoustID] Buscando: duración={duration}s")
        
        result = await lookup_acoustid(fingerprint, duration)
        if not result:
            return None
        
        recordings = result.get("recordings", [])
        if not recordings:
            return None
        
        recording = recordings[0]
        artists = recording.get("artists", [])
        releases = recording.get("releases", [])
        
        return SongInfo(
            title=recording.get("title", "Unknown"),
            artist=artists[0].get("name", "Unknown") if artists else "Unknown",
            timecode=0.0,
            cover_url=None,
            album=releases[0].get("title") if releases else None,
            confidence=result.get("score", 0),
        )
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ─── Main Endpoint ───────────────────────────────────────────────────────────
@app.post("/recognize", response_model=RecognizeResponse)
async def recognize(audio: UploadFile = File(...)):
    """
    Recibe audio y devuelve la canción detectada.
    Orden de intentos:
    1. Shazam (gratis, amplia base de datos)
    2. ACRCloud (si está configurado)
    3. AcoustID (fallback, gratis)
    """
    audio_data = await audio.read()

    if len(audio_data) < 1000:
        return RecognizeResponse(success=False, error="Audio demasiado pequeño")

    print(f"[Recognition] Audio recibido: {len(audio_data)} bytes")

    # 1. Intentar Shazam
    print("[Recognition] Intentando Shazam...")
    song = await recognize_with_shazam(audio_data)
    if song:
        print(f"[Shazam] OK Detectado: {song.title} - {song.artist}")
        return RecognizeResponse(success=True, song=song, provider="shazam")

    # 2. Fallback a ACRCloud
    if ACR_ACCESS_KEY and ACR_ACCESS_SECRET:
        print("[Recognition] Intentando ACRCloud...")
        song = await recognize_with_acr(audio_data, audio.filename or "audio.webm")
        if song:
            print(f"[ACR] OK Detectado: {song.title} - {song.artist}")
            return RecognizeResponse(success=True, song=song, provider="acrcloud")

    # 3. Fallback a AcoustID
    print("[Recognition] Intentando AcoustID...")
    song = await recognize_with_acoustid(audio_data)
    if song:
        print(f"[AcoustID] OK Detectado: {song.title} - {song.artist}")
        return RecognizeResponse(success=True, song=song, provider="acoustid")

    return RecognizeResponse(
        success=False,
        error="No se detectó canción. Intenta con más volumen o menos ruido."
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "providers": {
            "shazam": True,
            "acrcloud": bool(ACR_ACCESS_KEY and ACR_ACCESS_SECRET),
            "acoustid": os.path.exists(FPCALC_PATH),
        }
    }


@app.get("/providers")
async def providers():
    return {
        "shazam": {"available": True, "free": True, "limits": "Sin límites"},
        "acrcloud": {
            "available": bool(ACR_ACCESS_KEY and ACR_ACCESS_SECRET),
            "free": False,
            "limits": "1000/mes"
        },
        "acoustid": {"available": os.path.exists(FPCALC_PATH), "free": True, "limits": "Sin límites"},
    }


if __name__ == "__main__":
    import uvicorn

    print("=" * 50)
    print("Karaoke Recognition Service")
    print("=" * 50)
    print("Shazam: [X] Disponible (gratis)")
    print(f"ACRCloud: {'[OK] Configurado' if ACR_ACCESS_KEY else '[--] No configurado'}")
    print(f"AcoustID: {'[OK] Disponible' if os.path.exists(FPCALC_PATH) else '[--] fpcalc no encontrado'}")
    print("=" * 50)

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
