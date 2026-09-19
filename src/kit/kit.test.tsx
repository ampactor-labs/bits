// The kit's promises, tested: a toast can be undone and its expiry runs
// exactly once, an error banner is dismissible, a sheet traps focus and
// closes on Escape, and an icon button always has a name.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BannerProvider, BannerView, useBanner } from './Banner';
import { ToastProvider, ToastView, useToast } from './Toast';
import { Sheet } from './Sheet';
import { IconButton } from './IconButton';
import { ICON_NAMES, Icon } from './Icon';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function ToastHarness({ onUndo, onExpire }: { onUndo: () => void; onExpire: () => void }) {
  const toast = useToast();
  return (
    <button onClick={() => toast.undoable('dropped cat', onUndo, onExpire)}>go</button>
  );
}

describe('Toast', () => {
  it('runs undo and cancels the expiry', () => {
    const undo = vi.fn();
    const expire = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onUndo={undo} onExpire={expire} />
        <ToastView />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByText('dropped cat')).toBeTruthy();

    fireEvent.click(screen.getByText('undo'));
    expect(undo).toHaveBeenCalledOnce();

    act(() => void vi.advanceTimersByTime(10000));
    expect(expire).not.toHaveBeenCalled();
    expect(screen.queryByText('dropped cat')).toBeNull();
  });

  it('runs the expiry once when it is left alone', () => {
    const expire = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onUndo={() => {}} onExpire={expire} />
        <ToastView />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    act(() => void vi.advanceTimersByTime(6000));
    expect(expire).toHaveBeenCalledOnce();
    expect(screen.queryByText('dropped cat')).toBeNull();
  });

  it('collapses a repeated plain message instead of stacking it', () => {
    function Plain() {
      const toast = useToast();
      return <button onClick={() => toast.show('no person found')}>say</button>;
    }
    render(
      <ToastProvider>
        <Plain />
        <ToastView />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('say'));
    act(() => void vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByText('say'));
    expect(screen.getAllByText('no person found')).toHaveLength(1);
    // The repeat restarts the clock rather than queueing behind the first.
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByText('no person found')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2500));
    expect(screen.queryByText('no person found')).toBeNull();
  });

  it('never stacks more than three, and the dropped one still expires', () => {
    const expiries = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    function Many() {
      const toast = useToast();
      return (
        <button
          onClick={() =>
            expiries.forEach((fn, i) => toast.show(`m${i}`, { action: { label: 'x', run: () => {} }, onExpire: fn }))
          }
        >
          flood
        </button>
      );
    }
    render(
      <ToastProvider>
        <Many />
        <ToastView />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('flood'));
    expect(document.querySelectorAll('.toast')).toHaveLength(3);
    expect(screen.queryByText('m0')).toBeNull();
    expect(expiries[0]).toHaveBeenCalledOnce();
    expect(expiries[3]).not.toHaveBeenCalled();
  });
});

function BannerHarness() {
  const banner = useBanner();
  return <button onClick={() => banner.error('could not read that photo')}>boom</button>;
}

describe('Banner', () => {
  it('shows an error and dismisses it without unmounting anything else', () => {
    render(
      <BannerProvider>
        <BannerHarness />
        <BannerView />
      </BannerProvider>,
    );
    fireEvent.click(screen.getByText('boom'));
    expect(screen.getByText('could not read that photo')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('dismiss'));
    expect(screen.queryByText('could not read that photo')).toBeNull();
    // The thing that raised it is still on screen: an error is a banner,
    // never a screen of its own.
    expect(screen.getByText('boom')).toBeTruthy();
  });
});

describe('Sheet', () => {
  it('closes on Escape and on the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet title="cast" onClose={onClose}>
        <button>photo</button>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    const backdrop = container.querySelector('.sheet-backdrop')!;
    fireEvent.pointerDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is a labelled dialog and keeps focus inside', () => {
    render(
      <Sheet title="cast" onClose={() => {}}>
        <button>photo</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'cast' });
    expect(dialog).toBeTruthy();
    // First focusable inside the sheet takes focus on open.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('IconButton', () => {
  it('always carries an accessible name', () => {
    render(<IconButton icon="record" label="record a pass" />);
    expect(screen.getByRole('button', { name: 'record a pass' })).toBeTruthy();
  });
});

describe('Icon', () => {
  it('draws every named glyph with path data', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const d = container.querySelector('path')?.getAttribute('d') ?? '';
      expect(d.length, `icon ${name} has no path`).toBeGreaterThan(4);
      unmount();
    }
  });
});
