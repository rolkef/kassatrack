import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KassaTrack",
  description: "Preisverfolgung für den Lebensmitteleinkauf in Österreich",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-hintergrund font-sans text-vordergrund">
        {children}
      </body>
    </html>
  );
}
