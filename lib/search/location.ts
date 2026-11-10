import type { BoardJob } from "@/lib/sources/types";

// Region names a user might type, mapped to place names that appear in job locations.
const REGIONS: Record<string, string[]> = {
  socal: [
    "southern california", "socal", "los angeles", "santa monica", "culver city", "playa vista", "venice",
    "marina del rey", "el segundo", "hawthorne", "long beach", "torrance", "pasadena", "burbank", "glendale",
    "west hollywood", "hollywood", "beverly hills", "sherman oaks", "thousand oaks", "irvine", "costa mesa",
    "newport beach", "anaheim", "santa ana", "orange county", "san diego", "carlsbad", "la jolla", "riverside",
  ],
  "bay area": [
    "bay area", "san francisco", "oakland", "berkeley", "palo alto", "menlo park", "mountain view", "sunnyvale",
    "san jose", "santa clara", "cupertino", "redwood city", "san mateo", "foster city", "fremont",
  ],
  nyc: ["new york", "nyc", "brooklyn", "manhattan", "jersey city"],
  seattle: ["seattle", "bellevue", "redmond", "kirkland"],
  boston: ["boston", "cambridge", "somerville"],
  austin: ["austin"],
  chicago: ["chicago"],
  denver: ["denver", "boulder"],
  dc: ["washington, dc", "washington dc", "arlington", "reston", "mclean"],
};

const REGION_ALIASES: Record<string, string> = {
  "southern california": "socal",
  "so cal": "socal",
  "los angeles": "socal",
  la: "socal",
  "sf": "bay area",
  "san francisco": "bay area",
  "sf bay area": "bay area",
  "new york": "nyc",
  "new york city": "nyc",
  "washington dc": "dc",
};

// Remote roles limited to these places are not open to a US-based new grad.
const US_STATES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
// ", IN" and ", DE" are left out: they also mean India and Germany.
const US_STATE_CODES =
  "al|ak|az|ar|ca|co|ct|fl|ga|hi|id|il|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc";

/**
 * Says US: the country, a coast, a state name, or a ", XX" state code. A bare "America" is not
 * enough ("Remote - Latin America", "South America"; Phase 2 review S2).
 */
const US = new RegExp(
  `\\b(us|u\\.s\\.?a?|usa|united states|united states of america|west coast|east coast|${US_STATES})\\b|,\\s*(${US_STATE_CODES})\\b`,
  "i",
);
// Words that don't restrict where a remote job can be done.
const REMOTE_FILLER = /\b(remote|first|friendly|anywhere|flexible|only|optional|ok|work from home|wfh)\b/gi;

export type LocationPreference = {
  /** Places or regions, e.g. ["socal"], ["Seattle"], ["bay area", "nyc"]. Empty = anywhere. */
  places: string[];
  remoteOk: boolean;
};

/** Expands a user-typed place into lowercase names to look for in job locations. */
export function expandPlace(place: string): string[] {
  const key = place.trim().toLowerCase();
  const region = REGIONS[key] ? key : REGION_ALIASES[key];
  return region ? REGIONS[region] : [key];
}

function mentionsPlace(location: string, names: string[]): boolean {
  const text = location.toLowerCase();
  return names.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}

/**
 * A remote location string is open to someone in the US if it says US (or a US state/coast),
 * or says only "Remote" with no place attached. "Remote, KSA" or "Remote - Canada" is not.
 * Requiring a US signal is safer than listing every other country.
 */
export function isUsRemoteText(location: string): boolean {
  return US.test(location) || isPlainRemote(location);
}

/** "Remote", "Remote-first", "Remote (anywhere)": remote with no place attached. */
function isPlainRemote(location: string): boolean {
  return /\bremote\b/i.test(location) && location.replace(REMOTE_FILLER, "").replace(/[^a-z]/gi, "") === "";
}

/** Remote and open to someone in the US. */
export function isUsRemote(job: Pick<BoardJob, "remote" | "locations">): boolean {
  const remoteLocations = job.locations.filter((location) => /\bremote\b/i.test(location));
  if (remoteLocations.some((location) => US.test(location))) return true;

  // A bare "Remote" next to other places takes its meaning from them:
  // ["Remote", "London", "Poland"] is a European remote role, not a US one.
  if (remoteLocations.some(isPlainRemote)) {
    const places = job.locations.filter((location) => !isPlainRemote(location));
    return places.length === 0 || places.some((location) => US.test(location));
  }
  // Marked remote by the source but no remote location text: an office location must be in the US.
  return job.remote === "remote" && (job.locations.length === 0 || job.locations.some((location) => US.test(location)));
}

/** True if the job is in one of the preferred places, or is US-remote and remote is OK. */
export function matchesLocation(job: Pick<BoardJob, "remote" | "locations">, preference: LocationPreference): boolean {
  if (preference.places.length === 0 && !preference.remoteOk) return true;
  if (preference.remoteOk && isUsRemote(job)) return true;
  const names = preference.places.flatMap(expandPlace);
  return job.locations.some((location) => mentionsPlace(location, names));
}
