import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Die Schaltfläche der ruhigen Ebene: ein voller Block, mindestens 56 px hoch,
 * damit sie im Supermarkt mit dem Daumen zu treffen ist. Zwei Varianten
 * reichen — mehr Hierarchie braucht ein Bildschirm mit einer Aussage nicht.
 */
type Variante = "haupt" | "neben";

const varianten: Record<Variante, string> = {
  haupt: "bg-marke text-auf-marke hover:bg-marke-hell",
  neben: "border border-linie bg-hintergrund text-vordergrund hover:bg-flaeche",
};

type Eigenschaften = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  /** Zeigt statt des Symbols einen Fortschrittsring und setzt `aria-busy`. */
  laedt?: boolean;
  /** Bildmarke links vom Text. Wird für Hilfstechnik ausgeblendet. */
  symbol?: ReactNode;
};

export function Schaltflaeche({
  variante = "haupt",
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
      disabled={disabled ?? laedt}
      aria-busy={laedt || undefined}
      className={cn(
        "inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-3",
        "rounded-block px-6 text-[1.0625rem] leading-tight font-medium tracking-[-0.01em]",
        "transition-[background-color,border-color,color,translate] duration-150 ease-ruhig",
        "active:translate-y-px sm:min-h-16 sm:text-[1.125rem]",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0",
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
