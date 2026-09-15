import type { Metadata } from "next";
import "./catan.css";

export const metadata: Metadata = {
  title: "Die Siedler von Catan – Gameson",
  description: "Catan für 3–4 Personen: gemeinsam auf einem Gerät oder mit einer Online-Lobby. Wählbares Siegpunktziel, standardmäßig 12.",
  openGraph: { title: "Die Siedler von Catan – Gameson", description: "Handelt, baut und besiedelt die Insel. Für 3–4 Personen.", images: [] },
  twitter: { title: "Die Siedler von Catan – Gameson", description: "Handelt, baut und besiedelt die Insel. Für 3–4 Personen.", images: [] },
};
export default function CatanLayout({ children }: { children: React.ReactNode }) { return <div className="catan-theme">{children}</div>; }
