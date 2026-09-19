// A bit's still, in the list. Drawn from the recipe on mount, through the
// same drawStage everything else uses.

import { useEffect, useState } from 'react';
import { posterFor } from '../media/poster';
import { Icon } from '../kit/Icon';
import type { Project } from '../engine/recipe';

export function ShowPoster({ showId, project }: { showId: string; project: Project | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!project) return;
    void posterFor(showId, project).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [showId, project]);

  return (
    <span className="poster" aria-hidden="true">
      {/* Nothing cast yet: a bit that is still only its sound. */}
      {url ? <img src={url} alt="" /> : <Icon name="sound" size={18} />}
    </span>
  );
}
