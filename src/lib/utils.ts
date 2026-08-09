import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Führt Klassenlisten zusammen und lässt spätere Tailwind-Klassen frühere
 * derselben Eigenschaft überschreiben. Gleiche Signatur wie bei shadcn/ui,
 * damit dort übernommene Komponenten ohne Anpassung funktionieren.
 */
export function cn(...eingaben: ClassValue[]) {
  return twMerge(clsx(eingaben));
}
