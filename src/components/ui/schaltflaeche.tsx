import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Die geteilte Schaltfläche, in zwei Größen für die zwei Ebenen der App.
 *
 * `ruhig` ist die Alltagsoberfläche: ein voller Block, mindestens 56 px hoch,
 * im Supermarkt mit dem Daumen zu treffen. `dicht` gehört zur technischen
 * Detailebene — schmal, in der Zeile stehend, aber nie unter 44 px, weil auch
 * diese Ebene per Tap erreicht wird.
 *
 * Die Größe ist bewusst eine eigene Achse und nicht Sache des Aufrufers:
 * `twMerge` führt `min-h-14` und `sm:min-h-16` in getrennten Gruppen, ein
 * `className="min-h-9"` von außen überschriebe also nur die erste. Das Ergebnis
 * wäre eine Schaltfläche, die unter 640 px 36 px hoch ist und darüber 64 px —
 * lautlos und breitenabhängig falsch. Wer eine andere Größe braucht, nimmt
 * `groesse`, nicht `className`.
 */
type Variante = "haupt" | "neben";
type Groesse = "ruhig" | "dicht";

const varianten: Record<Variante, string> = {
  haupt: "bg-marke text-auf-marke hover:bg-marke-hell",
  // `linie-stark` statt `linie`: der Rand ist hier die einzige Grenze des
  // Bedienelements und muss deshalb die 3:1 aus WCAG 1.4.11 halten.
  neben: "border border-linie-stark bg-hintergrund text-vordergrund hover:bg-flaeche",
};

const groessen: Record<Groesse, string> = {
  ruhig: "min-h-14 w-full rounded-block px-6 text-[1.0625rem] sm:min-h-16 sm:text-[1.125rem]",
  dicht: "min-h-11 w-auto rounded-klein px-4 text-base",
};

type Eigenschaften = ComponentProps<"button"> & {
  variante?: Variante;
  groesse?: Groesse;
  /** Zeigt statt des Symbols einen Fortschrittsring und setzt `aria-busy`. */
  laedt?: boolean;
  /** Bildmarke links vom Text. Wird für Hilfstechnik ausgeblendet. */
  symbol?: ReactNode;
};

export function Schaltflaeche({
  variante = "haupt",
  groesse = "ruhig",
  laedt = false,
  symbol,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: Eigenschaften) {
  return (
    <button
      data-slot="schaltflaeche"
      type={type}
      // Bewusst `||` statt `??`: ein ausdrückliches `disabled={false}` neben
      // `laedt` ergäbe sonst eine bedienbare Schaltfläche mit Ladering.
      disabled={disabled || laedt}
      aria-busy={laedt || undefined}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-3",
        "leading-tight font-medium tracking-[-0.01em]",
        "transition-[background-color,border-color,color,translate] duration-150 ease-ruhig",
        "active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0",
        groessen[groesse],
        varianten[variante],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {laedt ? <Fortschritt /> : symbol}
      </span>
      {children}
    </button>
  );
}

/** Läuft bewusst auch bei `prefers-reduced-motion` weiter — er meldet Zustand. */
function Fortschritt() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 animate-spin">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path
        d="M18 10a8 8 0 0 0-8-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
