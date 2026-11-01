import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStreams } from '../src/features/chat/store.js';
import { resolveBindings, useShortcuts } from '../src/lib/shortcuts.js';
import { getBuiltinTheme } from '@lumen/shared';
import { startThemeEngine, useThemeStore } from '../src/lib/theme.js';

describe('stream store', () => {
  it('applies events per message, tracks reconnecting and clears', () => {
    const s = useStreams.getState();
    act(() => {
      s.apply('m', { type: 'text', text: 'hi' });
      s.setReconnecting('m', true);
    });
    expect(useStreams.getState().streams.m).toMatchObject({ text: 'hi', reconnecting: true });
    act(() => s.apply('m', { type: 'text', text: '!' }));
    expect(useStreams.getState().streams.m).toMatchObject({ text: 'hi!', reconnecting: false });
    act(() => s.clear('m'));
    expect(useStreams.getState().streams.m).toBeUndefined();
  });
});

describe('useShortcuts', () => {
  it('dispatches combos, ignores single keys while typing', () => {
    const palette = vi.fn();
    const help = vi.fn();
    renderHook(() => useShortcuts(resolveBindings({}), { palette, help }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(palette).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }));
    expect(help).toHaveBeenCalledTimes(1);
    const input = document.createElement('textarea');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
    expect(help).toHaveBeenCalledTimes(1);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    expect(palette).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    input.remove();
  });
});

describe('theme engine', () => {
  it('applies the resolved theme and follows preference changes and previews', () => {
    const stop = startThemeEngine();
    act(() => useThemeStore.getState().set({ mode: 'dark', darkThemeId: 'nord' }));
    expect(document.documentElement.style.getPropertyValue('--lm-bg')).toBe('#2e3440');
    act(() => useThemeStore.getState().preview(getBuiltinTheme('sepia')!));
    expect(document.documentElement.style.getPropertyValue('--lm-bg')).toBe(getBuiltinTheme('sepia')!.colors.background);
    act(() => useThemeStore.getState().preview(null));
    act(() => useThemeStore.getState().set({ mode: 'light', lightThemeId: 'paper' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
  });
});
