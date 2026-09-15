import type { Metadata } from "next";
import "./werewolf.css";

export const metadata: Metadata = {
  title: "Werwolf – Gameson",
  description: "Werwolf für eure Gruppe. Mit klaren Aufgaben und Schritt-für-Schritt-Begleitung – online oder auf einem Gerät.",
  openGraph: { title: "Werwolf – Gameson", description: "Wenn das Dorf schläft, beginnt die Jagd.", images: [] },
  twitter: { title: "Werwolf – Gameson", description: "Wenn das Dorf schläft, beginnt die Jagd.", images: [] },
};

export default function WerewolfLayout({ children }: { children: React.ReactNode }) {
  return <div className="werewolf-theme">{children}</div>;
}
