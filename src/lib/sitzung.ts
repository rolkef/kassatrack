import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type Benutzer = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

export async function holeSitzung() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser(): Promise<Benutzer> {
  const sitzung = await holeSitzung();
  if (!sitzung) redirect("/anmelden");

  return {
    id: sitzung.user.id,
    email: sitzung.user.email,
    name: sitzung.user.name,
    image: sitzung.user.image,
  };
}
