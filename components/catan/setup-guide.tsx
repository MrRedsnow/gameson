"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const STEPS = [
  { title: "Wähle eine Kreuzung", text: "Tippe auf ein Landschaftsfeld. In der Nahansicht wählst du eine Kreuzung zwischen den Feldern. Gebaut wird erst nach deiner Bestätigung." },
  { title: "Sichere dir verschiedene Rohstoffe", text: "Die Felder an deiner Siedlung liefern dir Rohstoffe. Holz und Lehm helfen bei Straßen; Wolle und Getreide brauchst du ebenfalls für neue Siedlungen." },
  { title: "Achte auf häufige Zahlen", text: "Von den Ertragszahlen fallen 6 und 8 am häufigsten, danach 5 und 9. Mehr Punkte unter einer Zahl bedeuten mehr Ertragschancen. Vergleiche Rohstoffe und Zahlen in der Bauplatzvorschau." },
];

export function SetupGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  return <aside className="catan-setup-guide" aria-label="Starthilfe zur Gründung">
    <div aria-live="polite"><small>Starthilfe · {step + 1} / {STEPS.length}</small><h3>{STEPS[step].title}</h3><p>{STEPS[step].text}</p></div>
    <div className="catan-guide-actions"><Button variant="ghost" onClick={onClose}>Überspringen</Button><Button variant="outline" onClick={() => step === STEPS.length - 1 ? onClose() : setStep(step + 1)}>{step === STEPS.length - 1 ? "Bauplatz wählen" : "Weiter"}</Button></div>
  </aside>;
}
