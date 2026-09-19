// Casting, one tap from the dock. Six ways to put something on stage, each
// saying what it does, plus the cast so far so you can pick a puppet that
// has wandered offstage.

import { Sheet } from '../../../kit/Sheet';
import { Icon, type IconName } from '../../../kit/Icon';
import { ProgressRing } from '../../../kit/Controls';
import { CastChip } from '../CastChip';
import type { ShowPuppet } from '../../../engine/show';
import type { StageImages } from '../../../media/stageDraw';

export type CastKind = 'photo' | 'selfie' | 'doodle' | 'word' | 'backdrop' | 'sticker';

export interface CastSheetProps {
  cast: ShowPuppet[];
  images: StageImages;
  seed: number;
  /** Set while a photo is being cut out. */
  busy: boolean;
  /** Bytes fetched so far on the first cutout, 0..1, or null when the
   *  model is already cached. */
  modelProgress: number | null;
  selectedId: string | null;
  onPick: (kind: CastKind) => void;
  onSelect: (puppetId: string) => void;
  onClose: () => void;
}

const TILES: { kind: CastKind; icon: IconName; label: string; sub: string }[] = [
  { kind: 'photo', icon: 'photo', label: 'a photo', sub: 'from the camera roll' },
  { kind: 'selfie', icon: 'selfie', label: 'a selfie', sub: 'cut out of the shot' },
  { kind: 'doodle', icon: 'doodle', label: 'draw one', sub: 'it will boil' },
  { kind: 'word', icon: 'text', label: 'a word', sub: 'it boils too' },
  { kind: 'backdrop', icon: 'backdrop', label: 'a backdrop', sub: 'behind everyone' },
  { kind: 'sticker', icon: 'sticker', label: 'a sticker', sub: 'soon' },
];

export function CastSheet({
  cast,
  images,
  seed,
  busy,
  modelProgress,
  selectedId,
  onPick,
  onSelect,
  onClose,
}: CastSheetProps) {
  return (
    <Sheet title="cast someone" onClose={onClose}>
      {busy && (
        <div className="cast-busy">
          <ProgressRing value={modelProgress} label="cutting out" />
          <span>
            {modelProgress === null
              ? 'cutting out…'
              : `getting the scissors · ${Math.round(modelProgress * 100)}% of 11MB, once`}
          </span>
        </div>
      )}
      <div className="cast-tiles">
        {TILES.map((t) => (
          <button
            key={t.kind}
            className="cast-tile"
            disabled={t.kind === 'sticker' || busy}
            onClick={() => onPick(t.kind)}
          >
            <Icon name={t.icon} size={28} />
            <span className="cast-tile-label">{t.label}</span>
            <span className="cast-tile-sub">{t.sub}</span>
          </button>
        ))}
      </div>
      {cast.length > 0 && (
        <>
          <span className="status">already on stage</span>
          <div className="cast-rail">
            {cast.map((p, i) => (
              <CastChip
                key={p.id}
                puppet={p}
                index={i}
                images={images}
                seed={seed}
                selected={selectedId === p.id}
                onClick={() => onSelect(p.id)}
              />
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
