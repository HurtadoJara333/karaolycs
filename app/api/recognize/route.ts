// app/api/recognize/route.ts
import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Validar tamaño mínimo (1KB)
    if (audioFile.size < 1000) {
      return NextResponse.json(
        { success: false, error: "Audio file too small" },
        { status: 400 }
      );
    }

    // Forward al microservicio Python
    const forward = new FormData();
    forward.append("audio", audioFile, audioFile.name || "snippet.webm");

    // Intentar con reintentos (máximo 2 reintentos)
    let lastError: string = "Unknown error";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/recognize`, {
          method: "POST",
          body: forward,
          signal: AbortSignal.timeout(20_000), // 20s max (ACRCloud puede ser lento)
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "Unknown error");
          console.error(`[/api/recognize] Python service error (attempt ${attempt + 1}):`, text);
          lastError = `Service error: ${res.status}`;
          
          // Esperar antes de reintentar (backoff exponencial)
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          
          return NextResponse.json(
            { success: false, error: "Recognition service unavailable" },
            { status: 502 }
          );
        }

        const data = await res.json();
        return NextResponse.json(data);

      } catch (fetchError: unknown) {
        const message = fetchError instanceof Error ? fetchError.message : "Unknown error";
        console.error(`[/api/recognize] Fetch error (attempt ${attempt + 1}):`, message);
        lastError = message;

        // Si es timeout o conexión rechazada, reintentar
        if (message.includes("timeout") || message.includes("ECONNREFUSED")) {
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
        }
        
        // Otros errores no se reintentan
        break;
      }
    }

    return NextResponse.json(
      { success: false, error: lastError },
      { status: 500 }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/recognize] Unexpected error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// Endpoint de salud para verificar el estado del servicio
export async function GET() {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    
    if (!res.ok) {
      return NextResponse.json(
        { status: "error", python: "unavailable" },
        { status: 503 }
      );
    }
    
    const data = await res.json();
    return NextResponse.json({ status: "ok", python: data });
  } catch {
    return NextResponse.json(
      { status: "error", python: "unreachable" },
      { status: 503 }
    );
  }
}

// Max body size para audio (~2MB para 8s de webm)
export const config = {
  api: { 
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};
