export type ContentMode = "family" | "adult";
export type LobbyStatus = "waiting" | "revealing" | "voting" | "results";
export type WordPair = { crew: string; imposter: string; category: string; rating: ContentMode };

export const CATEGORIES = [
  { id: "random", label: "Zufällig", rating: "family" as const },
  { id: "alltag", label: "Alltag", rating: "family" as const },
  { id: "essen", label: "Essen & Trinken", rating: "family" as const },
  { id: "orte", label: "Orte", rating: "family" as const },
  { id: "tiere", label: "Tiere", rating: "family" as const },
  { id: "freizeit", label: "Freizeit", rating: "family" as const },
  { id: "popkultur", label: "Popkultur", rating: "family" as const },
  { id: "nachtleben", label: "Nachtleben 18+", rating: "adult" as const },
  { id: "dating", label: "Dating 18+", rating: "adult" as const },
  { id: "custom", label: "Eigene Wörter", rating: "family" as const },
];

const family = (category: string, entries: [string, string][]): WordPair[] => entries.map(([crew, imposter]) => ({ crew, imposter, category, rating: "family" }));
const adult = (category: string, entries: [string, string][]): WordPair[] => entries.map(([crew, imposter]) => ({ crew, imposter, category, rating: "adult" }));

export const WORD_PAIRS: WordPair[] = [
  ...family("alltag", [["Zahnbürste","Haarbürste"],["Waschmaschine","Geschirrspüler"],["Schlüssel","Portemonnaie"],["Wecker","Stoppuhr"],["Regenschirm","Sonnencreme"],["Aufzug","Rolltreppe"],["Staubsauger","Wischmopp"],["Kopfhörer","Lautsprecher"]]),
  ...family("essen", [["Pizza","Flammkuchen"],["Kaffee","Kakao"],["Pommes","Kartoffelchips"],["Spaghetti","Ramen"],["Croissant","Brezel"],["Erdbeere","Himbeere"],["Ketchup","Mayonnaise"],["Eiscreme","Frozen Yogurt"]]),
  ...family("orte", [["Flughafen","Bahnhof"],["Bibliothek","Buchhandlung"],["Schwimmbad","Wasserpark"],["Supermarkt","Wochenmarkt"],["Museum","Galerie"],["Kino","Theater"],["Campingplatz","Hotel"],["Bäckerei","Café"]]),
  ...family("tiere", [["Delfin","Hai"],["Kaninchen","Meerschweinchen"],["Pinguin","Eisbär"],["Biene","Wespe"],["Pferd","Esel"],["Krokodil","Alligator"],["Eule","Falke"],["Robbe","Otter"]]),
  ...family("freizeit", [["Fußball","Handball"],["Wandern","Spazieren"],["Gitarre","Ukulele"],["Puzzeln","Malen"],["Joggen","Radfahren"],["Bowling","Billard"],["Stricken","Häkeln"],["Surfen","Segeln"]]),
  ...family("popkultur", [["Superheld","Superschurke"],["Zauberer","Hexe"],["Podcast","Hörbuch"],["Streaming","Fernsehen"],["Roboter","Cyborg"],["Detektiv","Spion"],["Zeitreise","Teleportation"],["Drache","Dinosaurier"]]),
  ...adult("nachtleben", [["Cocktail","Shot"],["Bar","Nachtclub"],["Kater","Blackout"],["Karaoke","Dancefloor"],["Afterparty","Vorglühen"],["Türsteher","Barkeeper"],["Champagner","Prosecco"],["VIP-Bereich","Backstage"]]),
  ...adult("dating", [["Blind Date","Speed Dating"],["Tinder","Bumble"],["Flirten","Anbaggern"],["Erstes Date","Jahrestag"],["Liebesbrief","Sexting"],["Kuss","Umarmung"],["Affäre","Beziehung"],["One-Night-Stand","Situationship"]]),
];

export function normalizeName(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de"); }
export function defaultImposterCount(players: number) { return Math.max(1, Math.min(4, Math.floor((players + 2) / 5))); }
export function maxImposterCount(players: number) { return Math.max(1, Math.ceil(players / 2) - 1); }
