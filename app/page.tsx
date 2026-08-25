"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function GamesonHome() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [installed, setInstalled] = useState(false);

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
        <span className="gameson-kicker">Eure Runde beginnt hier</span>
        <h1 id="gameson-title">Was spielt ihr heute?</h1>
        <p>Ein Handy oder mehrere – sucht euch ein Spiel aus und legt direkt los.</p>
      </section>

      <section className="game-library" aria-label="Spiel auswählen">
        <a className="library-card imposter-library-card" href="/imposter">
          <div className="library-card-art" aria-hidden="true"><i /><i /><b>?</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Bluff &amp; Wortspiel</span>
            <h2>IMPOSTER</h2>
            <p>Einer kennt nur die halbe Wahrheit. Findet heraus, wer blufft.</p>
            <div><span>3–22 Spieler</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </a>

        <a className="library-card werewolf-library-card" href="/werwolf">
          <div className="library-card-art moon-art" aria-hidden="true"><i /><b>☾</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Täuschung &amp; Rollen</span>
            <h2>WERWOLF</h2>
            <p>Das Dorf schläft nie ruhig. Entlarvt das Rudel, bevor es zu spät ist.</p>
            <div><span>Ab 3 Spielern</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </a>
      </section>

      <footer className="gameson-footer">
        <div className="gameson-footer-copy"><span />Keine Konten. Keine Vorbereitung. Einfach spielen.</div>
        {!installed && (
          <button className="gameson-install-button" type="button" onClick={() => void installApp()}>
            <span aria-hidden="true">↓</span> App installieren
          </button>
        )}
      </footer>

      {installHelpOpen && (
        <div className="sheet-backdrop gameson-install-backdrop">
          <button className="gameson-install-dismiss" type="button" aria-label="Installationshinweise schließen" onClick={() => setInstallHelpOpen(false)} />
          <section
            className="bottom-sheet gameson-install-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gameson-install-title"
          >
            <button className="sheet-close" type="button" aria-label="Schließen" onClick={() => setInstallHelpOpen(false)}>×</button>
            <span className="gameson-kicker">Gameson für deinen Startbildschirm</span>
            <h3 id="gameson-install-title">App installieren</h3>
            <div className="gameson-install-steps">
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
