// The finished film, presenting itself. It used to arrive as a toast and
// then live behind the word "share" in a menu, which meant the one thing
// the whole app is for was the hardest thing in it to find.

import { Sheet } from '../../../kit/Sheet';
import { IconButton } from '../../../kit/IconButton';

export interface RenderSheetProps {
  file: File;
  poster: string | null;
  durationS: number;
  onShare: () => void;
  onAgain: () => void;
  onClose: () => void;
}

const size = (bytes: number) =>
  bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.round(bytes / 1e3)}KB`;

export function RenderSheet({
  file,
  poster,
  durationS,
  onShare,
  onAgain,
  onClose,
}: RenderSheetProps) {
  return (
    <Sheet title="your film" onClose={onClose}>
      <div className="render-done">
        {poster && <img className="render-poster" src={poster} alt="" />}
        <span className="status">
          {Math.round(durationS)} seconds · {size(file.size)} · mp4
        </span>
      </div>
      <button className="primary" onClick={onShare}>
        send it
      </button>
      <div className="sheet-icons">
        <IconButton icon="render" label="make it again" showLabel onClick={onAgain} />
      </div>
      <span className="status">
        the film is made on this phone and kept until you leave the bit. the bit itself is
        always here.
      </span>
    </Sheet>
  );
}
