import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SongInfo {
  title: string;
  artist: string;
  timecode: number;
  cover_url: string | null;
  album: string | null;
}

// ─── SHAZAM ───────────────────────────────────────────────────────────────────
// Usa el endpoint interno de Shazam (reverse-engineered, sin API key)

async function recognizeWithShazam(
  audioData: Uint8Array,
): Promise<SongInfo | null> {
  try {
    // Shazam necesita el audio como raw bytes en una firma especial.
    // Usamos el endpoint público que acepta audio directo.
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().toUpperCase();

    const timezone = "America/Bogota";
    const url = `https://amp.shazam.com/discovery/v5/es/CO/android/-/tag/${uuid}/${uuid}`;

    // Shazam espera el audio como parte de un JSON con el sample en base64
    const audioBase64 = Buffer.from(audioData).toString("base64");

    const body = {
      signature: {
        uri: `data:audio/webm;base64,${audioBase64}`,
        samplems: 8000,
        timestamp,
        timezone,
      },
      geolocation: { altitude: 1495, latitude: 6.2, longitude: -75.6 }, // Medellín
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Shazam/3.17.0 (Android; 10)",
        "Accept-Language": "es-CO",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      console.warn("[Shazam] HTTP:", res.status);
      return null;
    }

    const data = (await res.json()) as any;
    console.log("[Shazam] Respuesta:", JSON.stringify(data).slice(0, 300));

    const track = data?.track;
    if (!track) return null;

    const images = track.images ?? {};
    const coverUrl =
      images.coverarthq ?? images.coverart ?? images.background ?? null;

    const sections = track.sections ?? [];
    const metaSection = sections.find((s: any) => s.type === "SONG");
    const albumMeta = metaSection?.metadata?.find(
      (m: any) => m.title === "Album",
    );

    return {
      title: track.title ?? "Desconocido",
      artist: track.subtitle ?? "Desconocido",
      timecode: (data?.timestamp ?? 0) / 1000,
      cover_url: coverUrl,
      album: albumMeta?.text ?? null,
    };
  } catch (err) {
    console.error("[Shazam] Error:", err);
    return null;
  }
}

// ─── ACRCLOUD ─────────────────────────────────────────────────────────────────

function buildACRSignature(
  accessKey: string,
  accessSecret: string,
  timestamp: number,
): string {
  const str = [
    "POST",
    "/v1/identify",
    accessKey,
    "audio",
    "1",
    timestamp.toString(),
  ].join("\n");
  return crypto.createHmac("sha1", accessSecret).update(str).digest("base64");
}

async function recognizeWithACR(
  audioData: Uint8Array,
): Promise<SongInfo | null> {
  const host = process.env.ACR_HOST;
  const accessKey = process.env.ACR_ACCESS_KEY;
  const accessSecret = process.env.ACR_ACCESS_SECRET;

  if (!host || !accessKey || !accessSecret) return null;

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = buildACRSignature(accessKey, accessSecret, timestamp);

    const formData = new FormData();
    formData.append(
      "sample",
      new Blob([audioData.buffer as ArrayBuffer], { type: "audio/webm" }),
      "sample.webm",
    );
    formData.append("access_key", accessKey);
    formData.append("data_type", "audio");
    formData.append("signature_version", "1");
    formData.append("signature", signature);
    formData.append("sample_bytes", audioData.length.toString());
    formData.append("timestamp", timestamp.toString());

    const res = await fetch(`https://${host}/v1/identify`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    const data = (await res.json()) as any;
    console.log("[ACR] Respuesta:", JSON.stringify(data).slice(0, 300));

    if (data?.status?.code !== 0) return null;

    const best = data?.metadata?.music?.[0];
    if (!best) return null;

    // Extraer cover igual que el Python
    let coverUrl: string | null = null;
    const albumData = best.album ?? {};
    const coverData = albumData.cover ?? {};
    const urls = coverData.url ?? [];
    for (const u of urls) {
      if (typeof u === "object") {
        if (u.name === "XL") {
          coverUrl = u.url;
          break;
        }
        if (!coverUrl) coverUrl = u.url;
      }
    }
    if (!coverUrl) {
      const extMeta = best.external_metadata ?? {};
      const spotify = extMeta.spotify ?? {};
      const spotifyCover = spotify.album?.cover;
      coverUrl = spotifyCover?.url ?? spotifyCover?.large ?? null;
      if (!coverUrl) {
        const ytVid = extMeta.youtube?.vid;
        if (ytVid)
          coverUrl = `https://img.youtube.com/vi/${ytVid}/mqdefault.jpg`;
      }
    }

    return {
      title: best.title ?? "Desconocido",
      artist: best.artists?.[0]?.name ?? "Desconocido",
      timecode: (best.play_offset_ms ?? 0) / 1000,
      cover_url: coverUrl,
      album: albumData.name ?? null,
    };
  } catch (err) {
    console.error("[ACR] Error:", err);
    return null;
  }
}

// ─── GET /api/recognize — health check ───────────────────────────────────────

export async function GET() {
  const hasACR =
    !!process.env.ACR_HOST &&
    !!process.env.ACR_ACCESS_KEY &&
    !!process.env.ACR_ACCESS_SECRET;
  return NextResponse.json({
    providers: { shazam: true, acrcloud: hasACR },
    status: "ready",
  });
}

// ─── POST /api/recognize ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // ── Leer audio ──────────────────────────────────────────────────────────
    const contentType = req.headers.get("content-type") ?? "";
    let audioData: Uint8Array | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        const entry = value as any;
        if (entry instanceof File || entry instanceof Blob) {
          console.log("[recognize] FormData field:", key, "size:", entry.size);
          audioData = new Uint8Array(await entry.arrayBuffer());
          break;
        }
      }
    } else if (contentType.includes("application/json")) {
      const json = (await req.json()) as { audio?: string };
      if (json.audio)
        audioData = new Uint8Array(Buffer.from(json.audio, "base64"));
    } else {
      const ab = await req.arrayBuffer();
      if (ab.byteLength > 0) audioData = new Uint8Array(ab);
    }

    if (!audioData || audioData.byteLength < 1000) {
      return NextResponse.json(
        {
          success: false,
          error: "Audio no recibido o demasiado pequeño.",
          debug: { contentType, bytes: audioData?.byteLength ?? 0 },
        },
        { status: 400 },
      );
    }

    console.log("[recognize] Audio recibido:", audioData.byteLength, "bytes");

    // ── Pipeline: Shazam → ACRCloud ─────────────────────────────────────────
    console.log("[recognize] Intentando Shazam...");
    let song = await recognizeWithShazam(audioData);

    if (song) {
      console.log("[recognize] Shazam OK:", song.title, "-", song.artist);
      return NextResponse.json({ success: true, song, provider: "shazam" });
    }

    console.log("[recognize] Shazam falló, intentando ACRCloud...");
    song = await recognizeWithACR(audioData);

    if (song) {
      console.log("[recognize] ACR OK:", song.title, "-", song.artist);
      return NextResponse.json({ success: true, song, provider: "acrcloud" });
    }

    return NextResponse.json({ success: false, song: null });
  } catch (err) {
    console.error("[recognize] Error:", err);
    return NextResponse.json(
      { success: false, error: "Error interno" },
      { status: 500 },
    );
  }
}
