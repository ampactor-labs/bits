// Shared setup for the jsdom project. Testing Library only auto-cleans when
// Vitest runs with globals, which this project does not, so unmount between
// tests explicitly or every render stacks onto the last one's DOM.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
