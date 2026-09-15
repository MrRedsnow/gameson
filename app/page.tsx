"use client";

import { useEffect, useRef, useState } from "react";
import { Hexagon, PencilLine } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function GamesonHome() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const installButtonRef = useRef<HTMLButtonElement>(null);
  const installSheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("lobby") || params.has("join") || params.has("local")) {
      window.location.replace(`/imposter${window.location.search}`);
      return;
    }

    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const standaloneCheck = window.requestAnimationFrame(() => setInstalled(standalone));

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }

    const rememberInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const rememberInstallation = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstallHelpOpen(false);
    };

    window.addEventListener("beforeinstallprompt", rememberInstallPrompt);
    window.addEventListener("appinstalled", rememberInstallation);
    return () => {
      window.cancelAnimationFrame(standaloneCheck);
      window.removeEventListener("beforeinstallprompt", rememberInstallPrompt);
      window.removeEventListener("appinstalled", rememberInstallation);
    };
  }, []);

  useEffect(() => {
    if (!installHelpOpen) return;
    const installButton = installButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    installSheetRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInstallHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      installButton?.focus();
    };
  }, [installHelpOpen]);

  const installApp = async () => {
    if (!installPrompt) {
      setInstallHelpOpen(true);
      return;
    }

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  };

  return (
    <main className="gameson-home">
      <div className="gameson-glow gameson-glow-one" aria-hidden="true" />
      <div className="gameson-glow gameson-glow-two" aria-hidden="true" />
      <header className="gameson-header">
        <div className="gameson-wordmark"><span>G</span>GAMESON</div>
        <p>Spieleabend. Sofort.</p>
      </header>

      <section className="gameson-intro" aria-labelledby="gameson-title">
        <h1 id="gameson-title">Was spielt ihr heute?</h1>
        <p>Wählt ein Spiel. Ein Handy oder mehrere.</p>
      </section>

      <section className="game-library" aria-label="Spiel auswählen">
        <a className="library-card imposter-library-card" href="/imposter">
          <div className="library-card-art" aria-hidden="true"><i /><i /><b>?</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Bluff &amp; Wortspiel</span>
            <h2>IMPOSTER</h2>
            <p>Findet heraus, wer mit einem ähnlichen Wort blufft.</p>
            <div><span>3–22 Personen</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </a>

        <a className="library-card werewolf-library-card" href="/werwolf">
          <div className="library-card-art moon-art" aria-hidden="true"><i /><b>☾</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Täuschung &amp; Rollen</span>
            <h2>WERWOLF</h2>
            <p>Entlarvt das Rudel, bevor es euer Dorf übernimmt.</p>
            <div><span>3–22 Personen</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </a>
        <a className="library-card catan-library-card" href="/catan">
          <div className="library-card-art catan-library-art" aria-hidden="true"><Hexagon /></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Handel &amp; Strategie</span>
            <h2>CATAN</h2>
            <p>Die Siedler von Catan: Handelt, baut und besiedelt die Insel.</p>
            <div><span>3–4 Personen</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </a>
        <a className="library-card slf-library-card" href="/stadt-land-fluss">
          <div className="library-card-art slf-library-art" aria-hidden="true"><PencilLine /><b>Aa</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Wissen &amp; Wortwitz</span>
            <h2>STADT LAND FLUSS</h2>
            <p>Alle tippen gleichzeitig. Eure Spalten, euer Tempo, eure Abstimmung.</p>
            <div><span>2–22 Personen</span><span>Ein Handy pro Person</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </a>
      </section>

      <footer className="gameson-footer">
        <div className="gameson-footer-copy"><span />Keine Konten. Keine Vorbereitung. Einfach spielen.</div>
        {!installed && (
          <button
            ref={installButtonRef}
            className="gameson-install-button"
            type="button"
            aria-expanded={installHelpOpen}
            aria-controls="gameson-install-dialog"
            onClick={() => void installApp()}
          >
            <span aria-hidden="true">↓</span> App installieren
          </button>
        )}
      </footer>

      {installHelpOpen && (
        <div className="sheet-backdrop gameson-install-backdrop">
          <button className="sheet-dismiss" type="button" tabIndex={-1} aria-label="Installationshinweise schließen" onClick={() => setInstallHelpOpen(false)} />
          <section
            ref={installSheetRef}
            id="gameson-install-dialog"
            className="bottom-sheet gameson-install-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gameson-install-title"
            aria-describedby="gameson-install-description"
            tabIndex={-1}
          >
            <button className="sheet-close" type="button" aria-label="Schließen" onClick={() => setInstallHelpOpen(false)}>×</button>
            <span className="gameson-kicker">Gameson für deinen Startbildschirm</span>
            <h3 id="gameson-install-title">App installieren</h3>
            <div id="gameson-install-description" className="gameson-install-steps">
              <div><strong>iPhone &amp; iPad</strong><p>Öffne Gameson in Safari, tippe auf „Teilen“ und dann auf „Zum Home-Bildschirm“.</p></div>
              <div><strong>Android &amp; Chrome</strong><p>Öffne das Browsermenü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.</p></div>
            </div>
            <button className="gameson-install-done" type="button" onClick={() => setInstallHelpOpen(false)}>Verstanden</button>
          </section>
        </div>
      )}
    </main>
  );
}
