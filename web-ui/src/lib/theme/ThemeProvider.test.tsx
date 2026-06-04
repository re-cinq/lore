// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { FAMILY_KEY, SCHEME_KEY } from './theme-core';

type MediaListener = (e: { matches: boolean }) => void;

// Controllable matchMedia stub. `dark` decides what (prefers-color-scheme: dark)
// reports, and registered change listeners can be fired via `emit`.
function installMatchMedia(dark: boolean) {
  const listeners = new Set<MediaListener>();
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_: string, cb: MediaListener) =>
      listeners.add(cb),
    ),
    removeEventListener: vi.fn((_: string, cb: MediaListener) =>
      listeners.delete(cb),
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  const matchMedia = vi.fn(() => mql);
  Object.defineProperty(window, 'matchMedia', {
    value: matchMedia,
    configurable: true,
    writable: true,
  });
  return {
    matchMedia,
    mql,
    setMatches(next: boolean) {
      mql.matches = next;
    },
    emit() {
      listeners.forEach((cb) => cb({ matches: mql.matches }));
    },
    listenerCount: () => listeners.size,
  };
}

// Captures the live context value so assertions can read it and tests can
// invoke setFamily/setScheme through buttons (exercising the useCallback paths).
function Consumer() {
  const theme = useTheme();
  return (
    <div>
      <span data-testid="family">{theme.family}</span>
      <span data-testid="scheme">{theme.scheme}</span>
      <span data-testid="resolved">{theme.resolvedScheme}</span>
      <button onClick={() => theme.setFamily('retro')}>family-retro</button>
      <button onClick={() => theme.setFamily('elegant')}>family-elegant</button>
      <button onClick={() => theme.setScheme('dark')}>scheme-dark</button>
      <button onClick={() => theme.setScheme('light')}>scheme-light</button>
      <button onClick={() => theme.setScheme('auto')}>scheme-auto</button>
    </div>
  );
}

function familyAttr() {
  return document.documentElement.getAttribute('data-theme-family');
}
function schemeAttr() {
  return document.documentElement.getAttribute('data-color-scheme');
}

beforeEach(() => {
  localStorage.clear();
  delete window.__loreFamily;
  document.documentElement.removeAttribute('data-theme-family');
  document.documentElement.removeAttribute('data-color-scheme');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ThemeProvider seeding', () => {
  it('seeds family from window.__loreFamily when present', () => {
    installMatchMedia(false);
    window.__loreFamily = 'retro';
    // A conflicting DOM attribute must lose to the window global.
    document.documentElement.setAttribute('data-theme-family', 'elegant');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('family')).toHaveTextContent('retro');
  });

  it('seeds family from the data-theme-family attribute when window global absent', () => {
    installMatchMedia(false);
    document.documentElement.setAttribute('data-theme-family', 'retro');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('family')).toHaveTextContent('retro');
  });

  it('falls back to the default elegant family when neither source is set', () => {
    installMatchMedia(false);

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('family')).toHaveTextContent('elegant');
  });

  it('seeds scheme from localStorage', () => {
    installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'dark');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('scheme')).toHaveTextContent('dark');
  });

  it('falls back to the default auto scheme when localStorage holds garbage', () => {
    installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'sepia');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('scheme')).toHaveTextContent('auto');
  });
});

describe('ThemeProvider DOM application', () => {
  it('writes both data attributes and the window global on mount', () => {
    installMatchMedia(false);
    window.__loreFamily = 'retro';
    localStorage.setItem(SCHEME_KEY, 'light');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(familyAttr()).toBe('retro');
    expect(schemeAttr()).toBe('light');
    expect(window.__loreFamily).toBe('retro');
  });

  it('resolves auto scheme to dark when the OS prefers dark', () => {
    installMatchMedia(true);
    localStorage.setItem(SCHEME_KEY, 'auto');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(schemeAttr()).toBe('dark');
  });

  it('resolves auto scheme to light when the OS prefers light', () => {
    installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'auto');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(schemeAttr()).toBe('light');
  });

  it('honors an explicit dark scheme even when the OS prefers light', () => {
    installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'dark');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(schemeAttr()).toBe('dark');
  });
});

describe('ThemeProvider setters', () => {
  it('updates the family state, DOM attribute, and localStorage on setFamily', () => {
    installMatchMedia(false);

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByText('family-retro'));
    });

    expect(screen.getByTestId('family')).toHaveTextContent('retro');
    expect(familyAttr()).toBe('retro');
    expect(localStorage.getItem(FAMILY_KEY)).toBe('retro');
  });

  it('updates the scheme state, DOM attribute, and localStorage on setScheme', () => {
    installMatchMedia(false);

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByText('scheme-dark'));
    });

    expect(screen.getByTestId('scheme')).toHaveTextContent('dark');
    expect(schemeAttr()).toBe('dark');
    expect(localStorage.getItem(SCHEME_KEY)).toBe('dark');
  });
});

describe('ThemeProvider OS-auto media listener', () => {
  it('does not subscribe to media changes when the scheme is not auto', () => {
    const media = installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'light');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(media.mql.addEventListener).not.toHaveBeenCalled();
    expect(media.listenerCount()).toBe(0);
  });

  it('subscribes while auto and reapplies dark when the OS flips to dark', () => {
    const media = installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'auto');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(media.mql.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    expect(schemeAttr()).toBe('light');

    act(() => {
      media.setMatches(true);
      media.emit();
    });

    expect(schemeAttr()).toBe('dark');
  });

  it('reapplies light through the listener when the OS flips back to light', () => {
    const media = installMatchMedia(true);
    localStorage.setItem(SCHEME_KEY, 'auto');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(schemeAttr()).toBe('dark');

    act(() => {
      media.setMatches(false);
      media.emit();
    });

    expect(schemeAttr()).toBe('light');
  });

  it('removes the media change listener on unmount', () => {
    const media = installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'auto');

    const { unmount } = render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    expect(media.listenerCount()).toBe(1);

    unmount();

    expect(media.mql.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    expect(media.listenerCount()).toBe(0);
  });

  it('tears down the old listener and re-subscribes when switching away from then back to auto', () => {
    const media = installMatchMedia(false);
    localStorage.setItem(SCHEME_KEY, 'auto');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    expect(media.listenerCount()).toBe(1);

    // auto -> light: effect cleanup runs, early-return branch skips re-subscribe.
    act(() => {
      fireEvent.click(screen.getByText('scheme-light'));
    });
    expect(media.listenerCount()).toBe(0);
    expect(schemeAttr()).toBe('light');

    // light -> auto: listener registered again.
    act(() => {
      fireEvent.click(screen.getByText('scheme-auto'));
    });
    expect(media.listenerCount()).toBe(1);
  });
});

describe('useTheme outside a provider', () => {
  it('throws a descriptive error when used without a ThemeProvider', () => {
    installMatchMedia(false);
    // Silence the React error-boundary console output for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Consumer />)).toThrow(
      'useTheme must be used within a ThemeProvider',
    );

    spy.mockRestore();
  });
});
