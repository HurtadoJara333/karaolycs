import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ─── Tipos ACRCloud ───────────────────────────────────────────────────────────

interface ACRCloudResponse {
  status: { code: number; msg: string };
  metadata?: {
    music?: Array<{
      title: string;
      artists: Array<{ name: string }>;
      album?: { name: string };
      play_offset_ms?: number;
      duration_ms?: number;
    }>;
  };
}

// ─── Firma HMAC ───────────────────────────────────────────────────────────────

function buildSignature(
  accessKey: string,
  accessSecret: string,
  timestamp: number
): string {
  const stringToSign = [
    "POST",
    "/v1/identify",
    accessKey,
    "audio",
    "1",
    timestamp.toString(),
  ].join("\n");

  return crypto
    .createHmac("sha1", accessSecret)
    .update(stringToSign)
    .digest("base64");
}

// ─── ACRCloud ─────────────────────────────────────────────────────────────────

async function identifyWithACRCloud(audioBuffer: Buffer): Promise<{
  title: string;
  artist: string;
  timecode: number;
  coverUrl: string | null;
} | null> {
  const host        = process.env.ACR_HOST!;
  const accessKey   = process.env.ACR_ACCESS_KEY!;
  const accessSecret = process.env.ACR_ACCESS_SECRET!;
  const timestamp   = Math.floor(Date.now() / 1000);
  const signature   = buildSignature(accessKey, accessSecret, timestamp);

  const formData = new FormData();
  formData.append(
    "sample",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" }),
    "sample.webm"
  );
  formData.append("access_key", accessKey);
  formData.append("data_type", "audio");
  formData.append("signature_version", "1");
  formData.append("signature", signature);
  formData.append("sample_bytes", audioBuffer.length.toString());
  formData.append("timestamp", timestamp.toString());

  const res = await fetch(`https://${host}/v1/identify`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.error("ACRCloud HTTP error:", res.status, await res.text());
    return null;
  }

  const data: ACRCloudResponse = await res.json();

  if (data.status.code !== 0) {
    console.warn("ACRCloud sin resultado:", data.status.code, data.status.msg);
    return null;
  }

  const music = data.metadata?.music?.[0];
  if (!music) return null;

  return {
    title:    music.title ?? "Desconocido",
    artist:   music.artists?.[0]?.name ?? "Desconocido",
    timecode: (music.play_offset_ms ?? 0) / 1000,  // ms → segundos
    coverUrl: null, // ACRCloud free tier no devuelve cover art
  };
}

// ─── GET /api/recognize — health check ───────────────────────────────────────

export async function GET() {
  const hasACR =
    !!process.env.ACR_HOST &&
    !!process.env.ACR_ACCESS_KEY &&
    !!process.env.ACR_ACCESS_SECRET;

  return NextResponse.json({
    providers: { acrcloud: hasACR },
    status: hasACR ? "ready" : "missing_credentials",
  });
}

// ─── POST /api/recognize ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Credenciales primero — falla rápido si no están configuradas
    if (
      !process.env.ACR_HOST ||
      !process.env.ACR_ACCESS_KEY ||
      !process.env.ACR_ACCESS_SECRET
    ) {
      return NextResponse.json(
        { success: false, error: "Credenciales de ACRCloud no configuradas." },
        { status: 503 }
      );
    }

    // ── Leer audio (acepta cualquier formato que envíe el frontend) ──────────
    const contentType = req.headers.get("content-type") ?? "";
    let audioBuffer: Buffer | null = null;

    if (contentType.includes("multipart/form-data")) {
      // FormData: busca cualquier File/Blob sin importar el nombre del campo
      const formData = await req.formData();
      const entries = Array.from(formData.entries()) as Array<[string, FormDataEntryValue]>;
      for (const [key, value] of entries) {
        if (value instanceof File || value instanceof Blob) {
          console.log("[recognize] FormData field:", key, "size:", value.size);
          audioBuffer = Buffer.from(await value.arrayBuffer());
          break;
        }
      }
    } else if (contentType.includes("application/json")) {
      const json = (await req.json()) as { audio?: string };
      if (json.audio) audioBuffer = Buffer.from(json.audio, "base64");
    } else {
      // Raw binary (audio/webm, application/octet-stream, sin Content-Type…)
      const ab = await req.arrayBuffer();
      if (ab.byteLength > 0) audioBuffer = Buffer.from(ab);
    }

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No se recibió audio.",
          debug: { contentType },
        },
        { status: 400 }
      );
    }

    console.log("[recognize] Audio recibido:", audioBuffer.byteLength, "bytes");

    // ── Reconocer ────────────────────────────────────────────────────────────
    const song = await identifyWithACRCloud(audioBuffer);

    if (!song) {
      return NextResponse.json(
        { success: false, song: null },
        { status: 200 } // 200 para que el frontend lo maneje como "no encontrado"
      );
    }

    // ── Respuesta en el formato que espera KaraokeOrchestrator ───────────────
    return NextResponse.json({ success: true, song });
  } catch (err) {
    console.error("[recognize] Error:", err);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}