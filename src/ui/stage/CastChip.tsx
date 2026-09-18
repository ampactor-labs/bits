// A cast chip: what a puppet looks like, plus a name a screen reader can
// read out. The rail used to be one emoji per type, so a photo and a word
// were both a smiley and three doodles were three identical pencils.

import { useEffect, useRef } from 'react';
import { drawPuppetThumbnail, type StageImages } from '../../media/stageDraw';
import type { ShowPuppet } from '../../engine/show';

export interface CastChipProps {
  puppet: ShowPuppet;
  index: number;
  images: StageImages;
  seed: number;
  selected: boolean;
  onClick: () => void;
}

/** What to call a puppet that has no name of its own. */
export function puppetLabel(puppet: ShowPuppet, index: number): string {
  if (puppet.spec.name) return puppet.spec.name;
  if (puppet.back) return 'the backdrop';
  switch (puppet.spec.type) {
    case 'text':
      return `the word "${puppet.spec.text}"`;
    case 'doodle':
      return `doodle ${index + 1}`;
    case 'cutout':
      return `photo ${index + 1}`;
    default:
      return `puppet ${index + 1}`;
  }
}

const SIZE = 88;

export function CastChip({ puppet, index, images, seed, selected, onClick }: CastChipProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const image = images.get(puppet.id);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    drawPuppetThumbnail(ctx, puppet.spec, image, SIZE, seed);
  }, [puppet.spec, image, seed]);

  const label = puppetLabel(puppet, index);
  return (
    <button
      className={`chip${selected ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="chip-thumb" />
    </button>
  );
}
