import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  ExternalLink,
  ImageOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGlobeObservations } from '@/data/queries';
import { useGlobeStore } from '@/store/globeStore';
import { cn } from '@/lib/utils';
import type { GlobePhoto } from '@/data/globeApi';

/**
 * Photo gallery for one GLOBE land-cover observation.
 *
 * Photos come from the live GLOBE API, not the pipeline snapshot, so a
 * volunteer who uploads from the field can refresh and see their own
 * observation here.
 *
 * Images are loaded straight from data.globe.gov (which allows cross-origin
 * requests). They are full-resolution originals, so they load lazily and one at
 * a time in the lightbox rather than all at once in a grid.
 */

function PhotoTile({
  photo,
  onClick,
}: {
  photo: GlobePhoto;
  onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={photo.pending ? undefined : onClick}
      aria-disabled={photo.pending}
      title={photo.pending ? 'Uploaded to GLOBE, awaiting moderator approval' : photo.label}
      className={cn(
        'group relative aspect-4/3 overflow-hidden rounded-xs border border-border-1 bg-surface-2 transition-colors',
        photo.pending ? 'cursor-default' : 'hover:border-border-action',
      )}
    >
      {photo.pending ? (
        // Shown rather than hidden: the photo reached GLOBE and is queued for
        // moderation. Dropping it would make a freshly-uploaded observation look
        // like it had lost most of its photos.
        <span className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-icon-base">
          <Clock size={14} />
          <span className="text-[9px] leading-tight">Awaiting approval</span>
        </span>
      ) : failed || !photo.url ? (
        <span className="flex h-full items-center justify-center text-icon-base">
          <ImageOff size={16} />
        </span>
      ) : (
        <img
          src={photo.url}
          alt={photo.label}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white">
        {photo.label}
        {photo.heading !== null && (
          <span className="tnum inline-flex items-center gap-0.5 opacity-75">
            <Compass size={9} />
            {photo.heading}°
          </span>
        )}
      </span>
    </button>
  );
}

/** A photo GLOBE has actually published, so it has a real URL to render. */
type ViewablePhoto = GlobePhoto & { url: string };

function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: ViewablePhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, photos.length, onIndex, onClose]);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex flex-col bg-surface-0/97"
      onClick={onClose}
      role="presentation"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border-0 px-3 py-2">
        <span className="font-medium text-body">
          {photo.label}
          {photo.heading !== null && (
            <span className="tnum ml-2 text-icon-base">{photo.heading}°</span>
          )}
        </span>
        <span className="tnum text-icon-base">
          {index + 1} / {photos.length}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <img
          src={photo.url}
          alt={photo.label}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border-0 px-3 py-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index - 1 + photos.length) % photos.length);
          }}
          className="flex items-center gap-1 text-icon-base hover:text-icon-active"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <a
          href={photo.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-icon-base hover:text-icon-active"
        >
          Open original <ExternalLink size={11} />
        </a>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index + 1) % photos.length);
          }}
          className="flex items-center gap-1 text-icon-base hover:text-icon-active"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="panel-label">{label}</p>
      <p className="text-body">{children}</p>
    </div>
  );
}

export function GlobeGalleryDialog() {
  const openSite = useGlobeStore((s) => s.openSite);
  const close = useGlobeStore((s) => s.close);
  const fallback = useGlobeStore((s) => s.fallback);

  const { data, isLoading, isFetching, error, refetch } = useGlobeObservations();
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    setLightbox(null);
  }, [openSite]);

  // Every visit recorded at this site, newest first.
  const observations = openSite ? (data?.bySite.get(openSite) ?? []) : [];
  const allPhotos = observations.flatMap((o) => o.photos);
  // The lightbox pages through images only. Photos still awaiting GLOBE
  // moderation have no URL, so they are listed in the grid but cannot be opened
  // — indexing the lightbox against the full list would land on a blank frame.
  const viewable = allPhotos.filter((p): p is ViewablePhoto => p.url !== null);
  const viewIndex = new Map<GlobePhoto, number>(viewable.map((p, i) => [p, i]));
  const pendingCount = allPhotos.length - viewable.length;

  return (
    <Dialog open={openSite !== null} onOpenChange={(v) => !v && close()}>
      {/* No `relative` here: tailwind-merge would drop shadcn's `fixed` (both
          are position utilities) and the dialog would render below the fold.
          The lightbox is `fixed` instead, so it needs no positioned ancestor. */}
      <DialogContent className="max-h-[86vh] overflow-hidden rounded-lg border-border-1 bg-surface-1 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border-0 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-heading">
            GLOBE site
            <span className="tnum font-sans text-[11px] font-normal text-icon-base">
              {openSite}
              {observations.length > 0 && (
                <>
                  {' · '}
                  {observations.length} visit{observations.length === 1 ? '' : 's'}
                  {allPhotos.length > 0 && ` · ${allPhotos.length} photos`}
                  {pendingCount > 0 && ` (${pendingCount} awaiting approval)`}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              title="Re-check the GLOBE API for new photos"
              className="ml-auto mr-6 text-icon-base transition-colors hover:text-icon-active"
            >
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : undefined} />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(86vh-56px)] overflow-y-auto px-4 py-3">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-icon-base">
              <Loader2 size={15} className="animate-spin" />
              Loading observation…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xs border border-border-1 bg-surface-2 p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="text-body">Could not reach the GLOBE API.</p>
                <p className="mt-1 text-icon-base">{(error as Error).message}</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="mt-2 rounded-xs border border-border-1 px-2 py-0.5 text-icon-base hover:bg-surface-3 hover:text-body"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && observations.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-body">No photos published for this observation.</p>
              <p className="mt-1 text-icon-base">
                {fallback?.observed_date
                  ? `Recorded ${fallback.observed_date}.`
                  : null}{' '}
                GLOBE publishes photos separately from measurements, so they can lag by a
                day or two.
              </p>
            </div>
          )}

          {observations.map((o, oi) => {
            return (
              <section key={o.landCoverId} className={cn(oi > 0 && 'mt-5 border-t border-border-0 pt-4')}>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <Meta label={observations.length > 1 ? `Visit ${observations.length - oi}` : 'Measured'}>
                    <span className="tnum">{o.measuredDate}</span>
                  </Meta>
                  <Meta label="Position">
                    <span className="tnum">
                      {o.latitude.toFixed(4)}°, {o.longitude.toFixed(4)}°
                    </span>
                    {o.accuracyM !== null && (
                      <span className="tnum text-icon-base"> ±{o.accuracyM} m</span>
                    )}
                  </Meta>
                  <Meta label="Land cover">
                    {o.mucCode ? (
                      <>
                        <span className="tnum">{o.mucCode}</span>
                        {o.mucDescription && (
                          <span className="text-icon-base"> · {o.mucDescription}</span>
                        )}
                      </>
                    ) : (
                      // Every observation in this study area lacks a MUC code,
                      // which is exactly why none could train the model.
                      <span className="text-warning">Not classified</span>
                    )}
                  </Meta>
                </div>

                {(o.fieldNotes || o.conditions.length > 0) && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    {o.fieldNotes && (
                      <span className="rounded-xs border border-border-1 bg-surface-2 px-1.5 py-0.5 text-body">
                        “{o.fieldNotes}”
                      </span>
                    )}
                    {o.conditions.map((c, ci) => (
                      <span
                        key={`${c}-${ci}`}
                        className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-[10px] text-icon-base"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {o.photos.length === 0 ? (
                  <p className="py-4 text-center text-icon-base">No published photos.</p>
                ) : (
                  <>
                    <p className="panel-label mb-1.5">
                      {o.photos.length} photo{o.photos.length === 1 ? '' : 's'}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {o.photos.map((p) => (
                        // Keyed by direction, not URL: GLOBE returns the same
                        // literal "pending approval" string in every
                        // unmoderated photo's URL field, so URLs are not
                        // unique. The direction label is one per observation.
                        <PhotoTile
                          key={p.label}
                          photo={p}
                          onClick={() => {
                            const i = viewIndex.get(p);
                            if (i !== undefined) setLightbox(i);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>

        {viewable.length > 0 && lightbox !== null && (
          <Lightbox
            photos={viewable}
            index={lightbox}
            onIndex={setLightbox}
            onClose={() => setLightbox(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export const galleryClasses = cn();
