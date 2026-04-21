import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ACRCloudMetadata {
  music?: Array<{
    title: string;
    artists: Array<{ name: string }>;
    album?: { name: string };
    play_offset_ms?: number;
    duration_ms?: number;
    external_ids?: { isrc?: string };
  }>;
}

interface ACRCloudResponse {
  status: { code: number; msg: string };
  metadata?: ACRCloudMetadata;
  result_type?: number;
}

interface RecognizeResult {
  title: string;
  artist: string;
  album: string;
  playOffsetMs: number;
  durationMs: number;
  provider: "acrcloud";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildACRCloudSignature(
  accessKey: string,
  accessSecret: string,
  timestamp: number,
  dataType: string = "audio",
  signatureVersion: string = "1"
): { signature: string; timestamp: number } {
  const stringToSign = [
    "POST",
    "/v1/identify",
    accessKey,
    dataType,
    signatureVersion,
    timestamp.toString(),
  ].join("\n");

  const signature = crypto
    .createHmac("sha1", accessSecret)
    .update(stringToSign)
    .digest("base64");

  return { signature, timestamp };
}

async function identifyWithACRCloud(
  audioBuffer: Buffer,
  host: string,
  accessKey: string,
  accessSecret: string
): Promise<RecognizeResult | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const { signature } = buildACRCloudSignature(
    accessKey,
    accessSecret,
    timestamp
  );

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

  const url = `https://${host}/v1/identify`;

  const res = await fetch(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.error("ACRCloud HTTP error:", res.status, await res.text());
    return null;
  }

  const data: ACRCloudResponse = await res.json();

  // code 0 = éxito, 1001 = no encontrado
  if (data.status.code !== 0) {
    console.warn("ACRCloud no encontró la canción:", data.status.msg);
    return null;
  }

  const music = data.metadata?.music?.[0];
  if (!music) return null;

  return {
    title: music.title ?? "Desconocido",
    artist: music.artists?.[0]?.name ?? "Desconocido",
    album: music.album?.name ?? "",
    playOffsetMs: music.play_offset_ms ?? 0,
    durationMs: music.duration_ms ?? 0,
    provider: "acrcloud",
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

// ─── POST /api/recognize — reconocimiento principal ───────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Leer el audio del body (FormData o raw binary)
    const contentType = req.headers.get("content-type") ?? "";

    let audioBuffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("sample") as File | null;
      if (!file) {
        return NextResponse.json(
          { error: "No se recibió audio (campo 'sample' faltante)" },
          { status: 400 }
        );
      }
      audioBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      // Raw binary / application/octet-stream
      const arrayBuffer = await req.arrayBuffer();
      if (!arrayBuffer.byteLength) {
        return NextResponse.json(
          { error: "Body vacío" },
          { status: 400 }
        );
      }
      audioBuffer = Buffer.from(arrayBuffer);
    }

    // Validar credenciales
    const host = process.env.ACR_HOST;
    const accessKey = process.env.ACR_ACCESS_KEY;
    const accessSecret = process.env.ACR_ACCESS_SECRET;

    if (!host || !accessKey || !accessSecret) {
      return NextResponse.json(
        {
          error:
            "Credenciales de ACRCloud no configuradas. Revisa ACR_HOST, ACR_ACCESS_KEY y ACR_ACCESS_SECRET en las variables de entorno.",
        },
        { status: 503 }
      );
    }

    // Reconocer
    const result = await identifyWithACRCloud(
      audioBuffer,
      host,
      accessKey,
      accessSecret
    );

    if (!result) {
      return NextResponse.json(
        { error: "No se pudo identificar la canción" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Error en /api/recognize:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}