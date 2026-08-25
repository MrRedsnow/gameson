"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GamesonHome() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("lobby") || params.has("join") || params.has("local")) {
      window.location.replace(`/imposter${window.location.search}`);
    }
  }, []);

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
        <Link className="library-card imposter-library-card" href="/imposter">
          <div className="library-card-art" aria-hidden="true"><i /><i /><b>?</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Bluff &amp; Wortspiel</span>
            <h2>IMPOSTER</h2>
            <p>Einer kennt nur die halbe Wahrheit. Findet heraus, wer blufft.</p>
            <div><span>3–22 Spieler</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </Link>

        <Link className="library-card werewolf-library-card" href="/werwolf">
          <div className="library-card-art moon-art" aria-hidden="true"><i /><b>☾</b></div>
          <div className="library-card-copy">
            <span className="library-eyebrow">Täuschung &amp; Rollen</span>
            <h2>WERWOLF</h2>
            <p>Das Dorf schläft nie ruhig. Entlarvt das Rudel, bevor es zu spät ist.</p>
            <div><span>Ab 3 Spielern</span><span>Online &amp; 1 Gerät</span></div>
          </div>
          <strong>Spielen <span>→</span></strong>
        </Link>
      </section>

      <footer className="gameson-footer"><span />Keine Konten. Keine Vorbereitung. Einfach spielen.</footer>
    </main>
  );
}
