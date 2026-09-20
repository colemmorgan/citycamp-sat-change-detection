import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { fmtPct } from '@/data/loader';
import type { Stats } from '@/data/types';

/**
 * Data sources, attribution and method notes.
 *
 * AlphaEarth, Copernicus and GLOBE all require attribution, and the strings are
 * carried in stats.json rather than hardcoded so they track the pipeline.
 * Model numbers live here too — they belong in the record, not in the operating
 * surface of the map.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-border-0 py-2 last:border-b-0">
      <dt className="panel-label pt-0.5">{label}</dt>
      <dd className="leading-snug text-body">{children}</dd>
    </div>
  );
}

export function CreditsDialog({ stats }: { stats: Stats }) {
  const m = stats.model;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-icon-base transition-colors hover:text-icon-active"
        >
          Credits &amp; sources
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[80vh] overflow-y-auto rounded-lg border-border-1 bg-surface-1 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-heading">Credits &amp; sources</DialogTitle>
          <DialogDescription className="text-icon-base">
            Satellite change detection over Alachua County, {stats.years.before} to{' '}
            {stats.years.after}.
          </DialogDescription>
        </DialogHeader>

        <dl className="mt-1">
          <Row label="Embeddings">{stats.credits.alphaearth}</Row>
          <Row label="Imagery">{stats.credits.sentinel2}</Row>
          <Row label="Observations">{stats.credits.globe}</Row>
          <Row label="Protected land">
            Protected Areas Database of the United States (PAD-US), USGS.
          </Row>
          <Row label="Basemaps">
            Esri, HERE, Garmin, © OpenStreetMap contributors. Satellite imagery: Esri, Maxar,
            Earthstar Geographics.
          </Row>
          <Row label="Supplementary labels">
            OpenStreetMap land-use polygons, used to supplement classes with too few
            volunteer observations to train on. Disclosed, not hidden.
          </Row>
          <Row label="Curriculum">
            Adapted from EMERGE Textbook 2, Chapter 5, Lesson 1 — “Mapping Land Cover From
            GLOBE Data and Satellite Embeddings”. Ported off Earth Engine so the lesson runs
            without an EE account.
          </Row>
          <Row label="Method">
            Change is cosine distance between per-pixel AlphaEarth embeddings. Confirmed
            transitions additionally require a land-cover class flip and{' '}
            <span className="tnum">{stats.change.l4_percentile}</span>th-percentile change,
            gated at <span className="tnum">{stats.change.l4_threshold.toFixed(3)}</span>.
          </Row>
          <Row label="Classifier">
            Random forest, 4 classes. Accuracy{' '}
            <span className="tnum">{fmtPct(m.accuracy)}</span> against a{' '}
            <span className="tnum">{fmtPct(m.baseline_majority)}</span> majority-class
            baseline, {m.n_train} train / {m.n_test} test. Trained on {m.n_globe} GLOBE points
            plus {m.n_osm} OpenStreetMap labels. Accuracy is not the deliverable — the ranked
            task list is.
          </Row>
          <Row label="Grid">
            Analysed at <span className="tnum">{stats.analysis_res_m}</span> m in EPSG:
            {stats.analysis_epsg}; delivered at{' '}
            <span className="tnum">{stats.resolution_m.toFixed(2)}</span> m in EPSG:3857.
          </Row>
          <Row label="Generated">
            <span className="tnum">
              {stats.generated_utc.slice(0, 16).replace('T', ' ')} UTC
            </span>
          </Row>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
