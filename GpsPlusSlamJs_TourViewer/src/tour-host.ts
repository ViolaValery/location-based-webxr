/**
 * Where the tour lives (polish round M2, A6/A7): the host the creator picks
 * first, its own upload-and-link steps, and the stored choice the later
 * steps read. The copy here is provisional (the owner's prototype verdict
 * may restyle it) and lives in one place for that reason. Pure, apart from
 * the injected store.
 *
 * @see tour-host.ts.md
 */

/** The hosts the page knows to work. */
export const TOUR_HOSTS = [
  { id: "drive", label: "Google Drive" },
  { id: "dropbox", label: "Dropbox" },
  { id: "onedrive", label: "OneDrive" },
  { id: "github", label: "GitHub" },
  { id: "own", label: "Your own server" },
] as const;

export type TourHost = (typeof TOUR_HOSTS)[number]["id"];

const HOST_IDS: ReadonlySet<string> = new Set(TOUR_HOSTS.map((h) => h.id));

export function isTourHost(value: unknown): value is TourHost {
  return typeof value === "string" && HOST_IDS.has(value);
}

/** Each host's own steps, ending at the link the next step asks for. */
const HOST_STEPS: Readonly<Record<TourHost, readonly string[]>> = {
  drive: [
    "Download the empty starter tour below (tour.zip).",
    'Upload it into a folder of its own in Google Drive (e.g. "My tour").',
    'Share the file: "Anyone with the link", then copy the link.',
    "Continue and paste that link.",
  ],
  dropbox: [
    "Download the empty starter tour below (tour.zip).",
    'Upload it into a folder of its own in Dropbox (e.g. "My tour").',
    "Share the file so anyone with the link can view it, and copy the link.",
    "Continue and paste that link.",
  ],
  onedrive: [
    "Download the empty starter tour below (tour.zip).",
    'Upload it into a folder of its own in OneDrive (e.g. "My tour").',
    'Share the file: "Anyone with the link can view", then copy the link.',
    "Continue and paste that link.",
  ],
  github: [
    "Download the empty starter tour below (tour.zip).",
    'Add it to a public repository ("Add file", "Upload files").',
    "Open the file on GitHub and copy its address from the browser.",
    "Continue and paste that link.",
  ],
  own: [
    "Choose where tour.zip will live on your server - you can paste the link before the file exists, and upload it later.",
    "The server must let other sites read the file (Access-Control-Allow-Origin: *) and send parts of it (Accept-Ranges: bytes).",
    "Continue and paste that link.",
  ],
};

export function hostSteps(host: TourHost): readonly string[] {
  return HOST_STEPS[host];
}

/** Whether the host needs a file before it gives a link: every cloud host;
 *  an own server's link is known before the file exists. */
export function needsStarterZip(host: TourHost): boolean {
  return host !== "own";
}

/** The store slice the choice lives in (`localStorage`). */
export interface TourHostStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const HOST_KEY = "tour-viewer.wizard.host";

/** The stored host, or null: none chosen, an unknown value, or a store
 *  that is missing or throws (site data blocked). */
export function readTourHost(
  store: TourHostStore | undefined,
): TourHost | null {
  if (store === undefined) return null;
  try {
    const value = store.getItem(HOST_KEY);
    return isTourHost(value) ? value : null;
  } catch {
    return null;
  }
}

/** Store the choice; a store that throws is ignored (the choice then lasts
 *  this page only). */
export function writeTourHost(
  store: TourHostStore | undefined,
  host: TourHost,
): void {
  try {
    store?.setItem(HOST_KEY, host);
  } catch {
    // Site data blocked: the choice holds for this page only.
  }
}
