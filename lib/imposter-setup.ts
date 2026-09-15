import { WORD_PAIRS, type ContentMode } from "./game";

type SavedPair = { crew: string; imposter: string; rating: ContentMode };

// Keep local name semantics: ignore blank rows, accept one-character names,
// and compare trimmed names without normalizing their internal whitespace.
export function validateImposterSetup(names: string[], mode: ContentMode, pool: string, customPairs: SavedPair[]) {
  const trimmedNames = names.map((name) => name.trim());
  const validNames = trimmedNames.filter(Boolean);
  const counts = new Map<string, number>();
  for (const name of validNames) {
    const key = name.toLocaleLowerCase("de");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateIndices = trimmedNames.flatMap((name, index) => name && (counts.get(name.toLocaleLowerCase("de")) ?? 0) > 1 ? [index] : []);
  const missing = Math.max(0, 3 - validNames.length);
  const nameError = missing
    ? `Noch ${missing} ${missing === 1 ? "Name" : "Namen"} erforderlich.`
    : duplicateIndices.length ? "Jeder Name darf nur einmal vorkommen." : "";
  const eligiblePairs = pool === "custom"
    ? customPairs.filter((pair) => mode === "adult" || pair.rating === "family")
    : WORD_PAIRS.filter((pair) => (mode === "adult" || pair.rating === "family") && (pool === "random" || pair.category === pool));
  const wordPoolError = eligiblePairs.length ? "" : pool === "custom"
    ? "Speichere mindestens ein Wortpaar für den gewählten Inhaltsmodus."
    : "In diesem Wortpool fehlt noch ein Wortpaar.";
  return {
    validNames, duplicateIndices, eligiblePairs, nameError, wordPoolError,
    canStart: !nameError && !wordPoolError,
  };
}
