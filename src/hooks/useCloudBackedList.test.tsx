// @vitest-environment jsdom
/**
 * Semantics of the durable-list gate, at the level the POS depends on:
 *
 *  - mounting never uploads anything;
 *  - "I have nothing yet" and "I deleted everyone" are different things, and
 *    only the second one is uploaded;
 *  - a device that has never seen the cloud copy and has no local copy either
 *    stays read-only, because anything it uploads would be invented data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  markSettingsHydrationSettled,
  resetSettingsHydrationForTests,
} from '../services/settingsHydration';

const persistSetting = vi.fn(async () => 'synced');

vi.mock('../services/settingsCloudService', () => ({
  persistSetting: (...args: unknown[]) => persistSetting(...(args as [])),
  DURABLE_SETTING_KEYS: ['pos_tables_list', 'pos_staff_list'],
}));

let cloudConfigured = true;
vi.mock('../services/cloudConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/cloudConfig')>()),
  isCloudConfigured: () => cloudConfigured,
}));

import { useCloudBackedList } from './useCloudBackedList';

const STAFF_KEY = 'pos_staff_list';
const CLOUD_STAFF = ['أحمد', 'سارة'];
const NO_STAFF: readonly string[] = [];

const pushes = () =>
  persistSetting.mock.calls.map((c) => [
    (c as unknown[])[0],
    JSON.parse((c as unknown[])[1] as string),
  ]);

function mount() {
  return renderHook(() => useCloudBackedList(STAFF_KEY, NO_STAFF));
}

describe('useCloudBackedList', () => {
  beforeEach(() => {
    localStorage.clear();
    persistSetting.mockClear();
    resetSettingsHydrationForTests();
    cloudConfigured = true;
  });

  afterEach(() => cleanup());

  it('uploads nothing on mount, with or without a cached list', () => {
    mount();
    expect(pushes()).toEqual([]);

    cleanup();
    localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
    mount();
    expect(pushes()).toEqual([]);
  });

  it('adopts the hydrated cloud list silently', () => {
    const { result } = mount();

    act(() => {
      localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
      markSettingsHydrationSettled(true);
    });

    expect(result.current.list).toEqual(CLOUD_STAFF);
    expect(pushes()).toEqual([]);
  });

  it('uploads a deliberate clear-all — an empty list IS a decision', () => {
    localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
    const { result } = mount();
    act(() => markSettingsHydrationSettled(true));

    act(() => result.current.setList([]));

    expect(result.current.list).toEqual([]);
    expect(pushes()).toEqual([[STAFF_KEY, []]]);
  });

  it('does not upload a no-op "edit" that changes nothing', () => {
    localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
    const { result } = mount();
    act(() => markSettingsHydrationSettled(true));

    act(() => result.current.setList([...CLOUD_STAFF]));

    expect(pushes()).toEqual([]);
  });

  it('supports updater functions like setState', () => {
    localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
    const { result } = mount();
    act(() => markSettingsHydrationSettled(true));

    act(() => result.current.setList((prev) => [...prev, 'منى']));

    expect(pushes()).toEqual([[STAFF_KEY, [...CLOUD_STAFF, 'منى']]]);
  });

  it('stays read-only when the hydrate FAILED and this device has no real copy', () => {
    const { result } = mount();

    act(() => markSettingsHydrationSettled(false));
    expect(result.current.canSync).toBe(false);

    act(() => result.current.setList(['أحمد']));

    // Kept locally for the operator, but never uploaded: a device that has
    // never seen the cloud copy must not invent one over it.
    expect(result.current.list).toEqual(['أحمد']);
    expect(JSON.parse(localStorage.getItem(STAFF_KEY) as string)).toEqual(['أحمد']);
    expect(pushes()).toEqual([]);
  });

  it('flushes that pending edit onto the cloud list once a hydrate succeeds', () => {
    const { result } = mount();
    act(() => markSettingsHydrationSettled(false));
    act(() => result.current.setList(['منى']));
    expect(pushes()).toEqual([]);

    act(() => {
      localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
      markSettingsHydrationSettled(true);
    });

    expect(result.current.list).toEqual([...CLOUD_STAFF, 'منى']);
    expect(pushes()).toEqual([[STAFF_KEY, [...CLOUD_STAFF, 'منى']]]);
  });

  it('lets an offline device with a real cached list keep saving edits', () => {
    localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
    const { result } = mount();

    act(() => markSettingsHydrationSettled(false));
    expect(result.current.canSync).toBe(true);

    act(() => result.current.setList([...CLOUD_STAFF, 'منى']));
    // Queued by persistSetting's own sync queue — the point is that we tried.
    expect(pushes()).toEqual([[STAFF_KEY, [...CLOUD_STAFF, 'منى']]]);
  });

  it('needs no gate at all when no cloud is configured', () => {
    cloudConfigured = false;
    const { result } = mount();

    expect(result.current.canSync).toBe(true);
    act(() => result.current.setList(['أحمد']));
    expect(pushes()).toEqual([[STAFF_KEY, ['أحمد']]]);
  });

  it('adopts a list another device changed, without echoing it back', () => {
    const { result } = mount();
    act(() => markSettingsHydrationSettled(true));

    act(() => {
      localStorage.setItem(STAFF_KEY, JSON.stringify(CLOUD_STAFF));
      window.dispatchEvent(new StorageEvent('storage', { key: STAFF_KEY }));
    });

    expect(result.current.list).toEqual(CLOUD_STAFF);
    expect(pushes()).toEqual([]);
  });

  it('ignores a corrupt cached value instead of uploading garbage', () => {
    localStorage.setItem(STAFF_KEY, '{not json');
    const { result } = mount();

    expect(result.current.list).toEqual([]);
    act(() => markSettingsHydrationSettled(false));
    // Corrupt cache counts as "no real copy": still read-only.
    expect(result.current.canSync).toBe(false);
    expect(pushes()).toEqual([]);
  });
});
