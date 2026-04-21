import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ─── ACRCLOUD ─────────────────────────────────────────────────────────────────

function buildACRSignature(accessKey: string, accessSecret: string, timestamp: number): string {
  const str = ["POST", "/v1/identify", accessKey, "audio", "1", timestamp.toString()].join("\n");
  return crypto.createHmac("sha1", accessSecret).update(str).digest("base64");
}

async function recognizeWithACR(audioData: Uint8Array): Promise<any | null> {
  const host         = process.env.ACR_HOST;
  const accessKey    = process.env.ACR_ACCESS_KEY;
  const accessSecret = process.env.ACR_ACCESS_SECRET;
  if (!host || !accessKey || !accessSecret) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildACRSignature(accessKey, accessSecret, timestamp);

  const formData = new FormData();
  formData.append("sample", new Blob([audioData.buffer as ArrayBuffer], { type: "audio/webm" }), "sample.webm");
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

  const data = await res.json() as any;
  console.log("[ACR] Status:", JSON.stringify(data?.status));
  console.log("[ACR] Metadata:", JSON.stringify(data?.metadata).slice(0, 500));
  console.log("[ACR] Full:", JSON.stringify(data).slice(0, 800));

  if (data?.status?.code !== 0) return null;

  const best = data?.metadata?.music?.[0];
  if (!best) return null;

  // Cover art
  let coverUrl: string | null = null;
  const albumData = best.album ?? {};
  const urls = albumData.cover?.url ?? [];
  for (const u of urls) {
    if (typeof u === "object") {
      if (u.name === "XL") { coverUrl = u.url; break; }
      if (!coverUrl) coverUrl = u.url;
    }
  }
  if (!coverUrl) {
    const extMeta = best.external_metadata ?? {};
    const spotifyCover = extMeta.spotify?.album?.cover;
    coverUrl = spotifyCover?.url ?? spotifyCover?.large ?? null;
    if (!coverUrl) {
      const ytVid = extMeta.youtube?.vid;
      if (ytVid) coverUrl = `https://img.youtube.com/vi/${ytVid}/mqdefault.jpg`;
    }
  }

  return {
    title: best.title ?? "Desconocido",
    artist: best.artists?.[0]?.name ?? "Desconocido",
    timecode: (best.play_offset_ms ?? 0) / 1000,
    cover_url: coverUrl,
    album: albumData.name ?? null,
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const hasACR = !!process.env.ACR_HOST && !!process.env.ACR_ACCESS_KEY && !!process.env.ACR_ACCESS_SECRET;
  return NextResponse.json({ providers: { acrcloud: hasACR }, status: hasACR ? "ready" : "missing_credentials" });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let audioData: Uint8Array | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        const entry = value as any;
        if (entry instanceof File || entry instanceof Blob) {
console.log("[recognize] FormData field:", key, "size:", entry.size, "type:", entry.type);          audioData = new Uint8Array(await entry.arrayBuffer());
          break;
        }
      }
    } else {
      const ab = await req.arrayBuffer();
      if (ab.byteLength > 0) audioData = new Uint8Array(ab);
    }

    if (!audioData || audioData.byteLength < 1000) {
      return NextResponse.json(
        { success: false, error: "Audio no recibido.", debug: { contentType, bytes: audioData?.byteLength ?? 0 } },
        { status: 400 }
      );
    }

    console.log("[recognize] Audio bytes:", audioData.byteLength);
    console.log("[recognize] Audio primeros bytes (hex):", Buffer.from(audioData.slice(0, 16)).toString("hex"));

    const song = await recognizeWithACR(audioData);

    if (!song) return NextResponse.json({ success: false, song: null });

    return NextResponse.json({ success: true, song });
  } catch (err) {
    console.error("[recognize] Error:", err);
    return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 });
  }
}