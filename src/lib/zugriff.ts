import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { allowedEmail } from "@/db/schema/zugriff";

export type ZugriffsDb = NodePgDatabase<Record<string, never>>;

export class ZugriffVerweigert extends Error {
  constructor(email?: string | null) {
    super(
      email
        ? `Die Adresse ${email} ist für KassaTrack nicht freigeschaltet.`
        : "Ohne freigeschaltete E-Mail-Adresse ist keine Anmeldung möglich.",
    );
    this.name = "ZugriffVerweigert";
  }
}

export function normalisiereEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function istEmailZugelassen(db: ZugriffsDb, email: string): Promise<boolean> {
  const normalisiert = normalisiereEmail(email);
  if (normalisiert === "") return false;

  const treffer = await db
    .select({ id: allowedEmail.id })
    .from(allowedEmail)
    .where(eq(allowedEmail.email, normalisiert))
    .limit(1);

  return treffer.length > 0;
}

export async function pruefeZugang(db: ZugriffsDb, email: string | undefined | null): Promise<void> {
  if (!email || !(await istEmailZugelassen(db, email))) {
    throw new ZugriffVerweigert(email);
  }
}
