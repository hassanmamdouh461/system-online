// @vitest-environment jsdom
/**
 * Regression guard: removing an item from a cloud-backed list must report
 * whether the removal reached D1.
 *
 * THE OUTAGE THIS PREVENTS
 * `commit` inside useCloudBackedList used to end with
 *
 *   if (persist) void persistSetting(key, JSON.stringify(next));
 *
 * `persistSetting` already returned a real `PersistOutcome`, and the `void`
 * discarded it. So deleting a table or a staff member removed the row from the
 * screen and from localStorage, and POSView printed nothing but success — even
 * when the cloud write had merely queued, or had been refused outright because
 * `enqueueSettingSync` returns 'forbidden' for a cashier session touching a
 * manager-only key (it deliberately does NOT queue a write that can only 403,
 * since a dead queue row lights up the "failed" badge forever).
 *
 * The operator then cleared site data. That wipes localStorage AND the
 * IndexedDB sync queue in one go, so the pending deletion vanished, the next
 * hydrate read the still-live row from D1, and the deleted table was back.
 *
 * These tests assert the outcome now travels all the way back to the caller,
 * which is the only thing that lets the screen choose green, amber or red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  markSettingsHydrationSettled,
  resetSettingsHydrationForTests,
} from '../services/settingsHydration';
import type { PersistOutcome } from '../services/settingsCloudService';

let nextOutcome: PersistOutcome = 'synced';
const persistSetting = vi.fn(async () => nextOutcome);

vi.mock('../services/settingsCloudService', () => ({
  persistSetting: (...args: unknown[]) => persistSetting(...(args as [])),
  DURABLE_SETTING_KEYS: ['pos_tables_list', 'pos_staff_list'],
}));

vi.mock('../services/cloudConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/cloudConfig')>()),
  isCloudConfigured: () => true,
}));

import { useCloudBackedList } from './useCloudBackedList';

const KEY = 'pos_tables_list';
const DEFAULTS = ['1', '2', '3'] as const;

/** Mount with a real cached list and an already-settled hydrate: the gate is open. */
function mountWithOpenGate(list: string[] = ['1', '2', '3']) {
  localStorage.setItem(KEY, JSON.stringify(list));
  markSettingsHydrationSettled(true);
  return renderHook(() => useCloudBackedList(KEY, DEFAULTS));
}

beforeEach(() => {
  localStorage.clear();
  resetSettingsHydrationForTests();
  persistSetting.mockClear();
  nextOutcome = 'synced';
});

afterEach(() => {
  cleanup();
});

describe('useCloudBackedList reports the real persist outcome', () => {
  it('resolves "synced" only when the cloud confirmed the write', async () => {
    nextOutcome = 'synced';
    const { result } = mountWithOpenGate();

    let outcome: PersistOutcome | undefined;
    await act(async () => {
      outcome = await result.current.setList((prev) => prev.filter((t) => t !== '2'));
    });

    expect(outcome).toBe('synced');
    expect(result.current.list).toEqual(['1', '3']);
  });

  it('resolves "queued" when the delete only made it into the sync queue', async () => {
    // This is the case that used to print a green "deleted". The row is gone
    // locally but D1 still has it, so a cache clear resurrects it.
    nextOutcome = 'queued';
    const { result } = mountWithOpenGate();

    let outcome: PersistOutcome | undefined;
    await act(async () => {
      outcome = await result.current.setList((prev) => prev.filter((t) => t !== '2'));
    });

    expect(outcome).toBe('queued');
    // The local view still updates — the operator keeps working. Only the
    // REPORTING changes.
    expect(result.current.list).toEqual(['1', '3']);
  });

  it('resolves "forbidden" when the session role may not write this key', async () => {
    // A certain failure, never retried, and previously invisible.
    nextOutcome = 'forbidden';
    const { result } = mountWithOpenGate();

    let outcome: PersistOutcome | undefined;
    await act(async () => {
      outcome = await result.current.setList((prev) => prev.filter((t) => t !== '3'));
    });

    expect(outcome).toBe('forbidden');
  });

  it('resolves "local_only" without pushing when the gate is still shut', async () => {
    // No cached list + hydrate not settled ⇒ this device does not yet know what
    // the cloud holds, so it must not upload. It also must not claim success:
    // the edit is held for the hydration replay, not written to D1.
    resetSettingsHydrationForTests();
    const { result } = renderHook(() => useCloudBackedList(KEY, DEFAULTS));

    let outcome: PersistOutcome | undefined;
    await act(async () => {
      outcome = await result.current.setList((prev) => prev.filter((t) => t !== '1'));
    });

    expect(outcome).toBe('local_only');
    expect(persistSetting).not.toHaveBeenCalled();
  });

  it('does not claim a cloud write for a no-op edit', async () => {
    // Removing something that is not in the list touches nothing. Reporting
    // 'synced' here would be a green toast for a write that never happened.
    nextOutcome = 'synced';
    const { result } = mountWithOpenGate();

    let outcome: PersistOutcome | undefined;
    await act(async () => {
      outcome = await result.current.setList((prev) => prev.filter((t) => t !== 'nope'));
    });

    expect(outcome).toBe('local_only');
    expect(persistSetting).not.toHaveBeenCalled();
  });

  it('reports a failed removal of the LAST item too', async () => {
    // "I deleted everyone" is a legitimate edit and does get pushed — so it can
    // also fail, and an empty staff list that never reached D1 refills itself
    // from the cloud on the next hydrate.
    nextOutcome = 'queued';
    const { result } = mountWithOpenGate(['only']);

    let outcome: PersistOutcome | undefined;
    await act(async () => {
      outcome = await result.current.setList([]);
    });

    expect(outcome).toBe('queued');
    expect(persistSetting).toHaveBeenCalledWith(KEY, JSON.stringify([]));
  });
});
