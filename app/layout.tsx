// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karaoke Teleprompter",
  description: "Letras en tiempo real para cualquier canción",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, padding: 0, background: "#050508" }}>
        {children}
      </body>
    </html>
  );
}
