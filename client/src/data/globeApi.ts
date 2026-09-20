import { AOI_4326 } from './constants';

/**
 * Live GLOBE Observer API.
 *
 * Verified from the browser: both api.globe.gov and the photo host
 * data.globe.gov send `access-control-allow-origin: *`, so this can be called
 * straight from the client with no proxy and no key.
 *
 * Fetched live rather than baked into the pipeline output deliberately — new
 * field observations appear here within a day or so, so a volunteer who uploads
 * photos can open the map and see them without the pipeline being re-run. The
 * shipped globe_points.geojson is the modelling snapshot; this is the current
 * truth.
 */

const ENDPOINT = 'https://api.globe.gov/search/v1/measurement/protocol/measureddate/lat/lon/';

/** GLOBE's land-cover photo directions, in the order a gallery should show them. */
export const PHOTO_DIRECTIONS = [
  { key: 'landcoversUpwardPhotoUrl', label: 'Up' },
  { key: 'landcoversNorthPhotoUrl', label: 'North' },
  { key: 'landcoversEastPhotoUrl', label: 'East' },
  { key: 'landcoversSouthPhotoUrl', label: 'South' },
  { key: 'landcoversWestPhotoUrl', label: 'West' },
  { key: 'landcoversDownwardPhotoUrl', label: 'Down' },
  { key: 'landcoversFeature1PhotoUrl', label: 'Feature 1' },
  { key: 'landcoversFeature2PhotoUrl', label: 'Feature 2' },
  { key: 'landcoversFeature3PhotoUrl', label: 'Feature 3' },
  { key: 'landcoversFeature4PhotoUrl', label: 'Feature 4' },
] as const;

export interface GlobePhoto {
  /** Absolute https URL, or null when the photo exists but is not yet public. */
  url: string | null;
  label: string;
  /**
   * True when GLOBE has the photo but a moderator has not released it. The API
   * signals this by putting the literal string "pending approval" in the URL
   * field rather than by omitting it, so the photo IS there — it just cannot be
   * shown yet. Worth surfacing rather than dropping: someone who has just
   * uploaded six photos needs to see that all six arrived.
   */
  pending: boolean;
  /** Compass heading in degrees, when the app recorded one. */
  heading: number | null;
}

export interface GlobeObservation {
  /**
   * The unique observation id. NOT `pid` — a single pid can carry several
   * separate land-cover observations (one site visited three times in a day
   * produces three records sharing a pid), and only landCoverId is unique.
   */
  landCoverId: number;
  /** Site/profile id. Matches `globe_id` in globe_points.geojson. Not unique. */
  pid: string;
  /**
   * Date the observation was measured, from the record's top-level
   * `measuredDate`. This is the field the pipeline used for `observed_date`, so
   * it is what keeps the dialog consistent with the map. The in-payload
   * `landcoversMeasuredAt` sometimes disagrees and is kept separately.
   */
  measuredDate: string;
  measuredAt: string;
  siteName: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
  accuracyM: number | null;
  fieldNotes: string | null;
  mucCode: string | null;
  mucDescription: string | null;
  /** Ground conditions recorded at the time, as display-ready labels. */
  conditions: string[];
  photos: GlobePhoto[];
}

type RawRecord = {
  pid: number | string;
  siteName?: string | null;
  latitude?: number;
  longitude?: number;
  elevation?: number | null;
  measuredDate?: string;
  data: Record<string, unknown>;
};

/** `((compassData.heading: 320, compassData.horizon: 30))` -> 320 */
function parseHeading(extra: unknown): number | null {
  if (typeof extra !== 'string') return null;
  const m = extra.match(/heading:\s*(-?\d+(?:\.\d+)?)/);
  return m?.[1] !== undefined ? Number(m[1]) : null;
}

const CONDITION_FIELDS: Array<[string, string]> = [
  ['landcoversDryGround', 'Dry ground'],
  ['landcoversMuddy', 'Muddy'],
  ['landcoversStandingWater', 'Standing water'],
  ['landcoversSnowIce', 'Snow / ice'],
  ['landcoversRainingSnowing', 'Raining or snowing'],
  ['landcoversLeavesOnTrees', 'Leaves on trees'],
];

function normalise(r: RawRecord): GlobeObservation {
  const d = r.data ?? {};

  const photos: GlobePhoto[] = [];
  for (const { key, label } of PHOTO_DIRECTIONS) {
    const raw = d[key];
    if (typeof raw !== 'string' || !raw) continue;
    // Anything that is not an absolute URL is a status word, not a link —
    // "pending approval" in practice. Rendering it as an <img src> yields a
    // broken tile, and using it as a React key collides across every direction
    // that shares the same status.
    const isUrl = /^https?:\/\//i.test(raw.trim());
    const featureMatch = key.match(/Feature(\d)/);
    const heading = featureMatch
      ? parseHeading(d[`landcoversFeature${featureMatch[1]}ExtraData`])
      : null;
    photos.push({ url: isUrl ? raw.trim() : null, pending: !isUrl, label, heading });
  }

  const conditions = CONDITION_FIELDS.filter(([f]) => d[f] === true).map(([, label]) => label);

  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    // GLOBE writes the literal strings "(none)" / "N/A" for empty free-text.
    if (!t || t === '(none)' || t.toLowerCase() === 'n/a') return null;
    return t;
  };

  return {
    landCoverId: num(d.landcoversLandCoverId) ?? -1,
    pid: String(r.pid),
    measuredDate: r.measuredDate ?? '',
    measuredAt: str(d.landcoversMeasuredAt) ?? r.measuredDate ?? '',
    siteName: r.siteName ?? null,
    latitude: num(d.landcoversMeasurementLatitude) ?? r.latitude ?? 0,
    longitude: num(d.landcoversMeasurementLongitude) ?? r.longitude ?? 0,
    elevation: num(d.landcoversMeasurementElevation) ?? r.elevation ?? null,
    accuracyM: num(d.landcoversLocationAccuracyM),
    fieldNotes: str(d.landcoversFieldNotes),
    mucCode: str(d.landcoversMucCode),
    mucDescription: str(d.landcoversMucDescription),
    conditions,
    photos,
  };
}

/**
 * Every land-cover observation in the study area, newest first.
 *
 * Deduplicated on landCoverId, NOT pid — collapsing by pid would silently throw
 * away two of the three observations recorded at one site and show photos from
 * the wrong visit.
 */
export async function fetchGlobeObservations(signal?: AbortSignal): Promise<GlobeObservation[]> {
  const [w, s, e, n] = AOI_4326;
  const today = new Date().toISOString().slice(0, 10);

  const url =
    `${ENDPOINT}?protocols=land_covers&startdate=2017-01-01&enddate=${today}` +
    `&minlat=${s}&maxlat=${n}&minlon=${w}&maxlon=${e}&geojson=FALSE&sample=FALSE`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GLOBE API: HTTP ${res.status}`);

  const json = (await res.json()) as { results?: RawRecord[] };
  const all = (json.results ?? []).map(normalise);

  const unique = new Map<number, GlobeObservation>();
  for (const obs of all) unique.set(obs.landCoverId, obs);

  return [...unique.values()].sort((a, b) => b.measuredDate.localeCompare(a.measuredDate));
}
