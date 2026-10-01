type FullscreenDocument = Pick<Document, "documentElement" | "fullscreenElement" | "fullscreenEnabled" | "exitFullscreen" | "addEventListener" | "removeEventListener">;

/** Owns only fullscreen requested by this island; the expanded layout also works without the API. */
export class IslandFullscreenController {
  expanded = false;
  private disposed = false;
  private requesting = false;
  private exiting = false;
  private ownsNative = false;

  constructor(private document: FullscreenDocument, private onChange: (expanded: boolean) => void) {
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
  }

  private update(expanded: boolean) {
    if (this.disposed || this.expanded === expanded) return;
    this.expanded = expanded;
    this.onChange(expanded);
  }

  private onFullscreenChange = () => {
    if (this.document.fullscreenElement === this.document.documentElement && this.requesting) {
      this.ownsNative = true;
      if (!this.expanded) this.releaseNative();
    } else if (this.ownsNative && this.document.fullscreenElement !== this.document.documentElement) {
      this.ownsNative = false;
      // An explicit exit may finish after the user has already reopened the island.
      if (!this.exiting) this.update(false);
    }
  };

  enter() {
    if (this.disposed) return;
    this.update(true);
    const root = this.document.documentElement;
    if (this.requesting || this.exiting || this.document.fullscreenElement || this.document.fullscreenEnabled === false || typeof root.requestFullscreen !== "function") return;
    this.requesting = true;
    try {
      // Keep this call in the click's user activation, before awaiting anything.
      void root.requestFullscreen({ navigationUI: "hide" }).then(() => {
        this.ownsNative = this.document.fullscreenElement === root;
        if (this.disposed || !this.expanded) this.releaseNative();
      }, () => {
        // A rejected request keeps the usable, viewport-filling layout.
      }).finally(() => { this.requesting = false; });
    } catch {
      this.requesting = false;
    }
  }

  exit() {
    this.update(false);
    this.releaseNative();
  }

  private releaseNative() {
    if (!this.ownsNative || this.exiting || this.document.fullscreenElement !== this.document.documentElement) return;
    this.exiting = true;
    void this.document.exitFullscreen().catch(() => {
      // The browser's own exit remains available; disposal can retry cleanup.
    }).finally(() => { this.exiting = false; });
  }

  dispose() {
    this.disposed = true;
    this.expanded = false;
    this.document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.releaseNative();
  }
}
