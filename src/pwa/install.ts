// The install prompt, held rather than dropped.
//
// Chromium fires beforeinstallprompt once, early, and the event is only
// usable if it was captured. Nothing is shown on its own: the app offers
// it where it makes sense and the person decides.

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let held: InstallPrompt | null = null;
const listeners = new Set<(available: boolean) => void>();

const announce = () => {
  for (const fn of listeners) fn(held !== null);
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  held = e as InstallPrompt;
  announce();
});

window.addEventListener('appinstalled', () => {
  held = null;
  announce();
});

export function onInstallAvailable(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  fn(held !== null);
  return () => listeners.delete(fn);
}

/** Resolves once the person has answered. The prompt is single-use. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = held;
  if (!prompt) return 'unavailable';
  held = null;
  announce();
  try {
    await prompt.prompt();
    return (await prompt.userChoice).outcome;
  } catch {
    return 'dismissed';
  }
}
