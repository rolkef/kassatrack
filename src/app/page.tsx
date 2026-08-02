import { requireUser } from "@/lib/sitzung";

export default async function StartSeite() {
  const benutzer = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">Servus, {benutzer.name}</h1>
      <p className="text-balance opacity-70">
        KassaTrack ist bereit. Die Preiserfassung kommt im nächsten Schritt.
      </p>
    </main>
  );
}
