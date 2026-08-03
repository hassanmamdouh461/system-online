// @vitest-environment jsdom
/**
 * Regression test for the settings DATA-LOSS bug (production: 2026-08-03 15:15:22Z).
 *
 * A till whose localStorage is empty — a brand-new device, a private window, a
 * cleared cache — used to seed `tables` / `staffList` from the hard-coded
 * defaults and then immediately upload them: the `[tables]` / `[staffList]`
 * effects run on MOUNT, not just on change. With settings writes working again
 * (PR #25) that mount write landed in D1 with a fresh timestamp, won the
 * freshness comparison against the older real value, and wiped the shop's real
 * table names (`["وي","التعاون","Engaz","tea","Tech"]` -> `["1".."8"]`) and the
 * whole staff list on every device.
 *
 * These tests drive the real component: mount it with an empty localStorage and
 * assert nothing is pushed, then let the cloud copy land and assert the device
 * adopts it instead of overwriting it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../context/LanguageContext';
import {
  markSettingsHydrationSettled,
  resetSettingsHydrationForTests,
} from '../../services/settingsHydration';

const persistSetting = vi.fn(async () => 'synced');

vi.mock('../../services/settingsCloudService', () => ({
  persistSetting: (...args: unknown[]) => persistSetting(...(args as [])),
  DURABLE_SETTING_KEYS: ['pos_tables_list', 'pos_staff_list'],
  MANAGER_ONLY_SETTING_KEYS: [],
}));

// The POS is cloud-configured in the shop; that is the configuration in which
// the data loss happened.
vi.mock('../../services/cloudConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/cloudConfig')>()),
  isCloudConfigured: () => true,
  getSessionRole: () => 'manager',
  refreshCloudSessionRole: async () => 'manager',
  cloudGetCollection: async () => [],
  cloudUpsert: async () => true,
  cloudSyncNow: async () => true,
}));

// Keep the component tree free of IndexedDB / printing / lookup side effects.
vi.mock('../../services/companiesService', () => ({
  companiesService: {
    getAll: vi.fn(async () => []),
    getById: vi.fn(async () => null),
  },
}));
vi.mock('../../utils/printReceipts', () => ({ printAllOrderTickets: vi.fn() }));
vi.mock('../payment/CustomerLookupStep', () => ({ CustomerLookupStep: () => null }));

import { POSView } from './POSView';

const CLOUD_TABLES = ['وي', 'التعاون', 'Engaz', 'tea', 'Tech'];
const CLOUD_STAFF = ['أحمد', 'سارة'];

/** What hydrateSettingsFromCloud does to this device: writes D1 into localStorage. */
function cloudHydrateArrives(
  tables: string[] = CLOUD_TABLES,
  staff: string[] = CLOUD_STAFF
) {
  localStorage.setItem('pos_tables_list', JSON.stringify(tables));
  localStorage.setItem('pos_staff_list', JSON.stringify(staff));
  markSettingsHydrationSettled(true);
}

function renderPOS() {
  return render(
    <LanguageProvider>
      <POSView menuItems={[]} onCreateOrder={async () => null} estimatedOrderNumber="1" />
    </LanguageProvider>
  );
}

/** Let mount effects, subscriptions and their microtasks flush. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

const pushedKeys = () => persistSetting.mock.calls.map((c) => (c as unknown[])[0]);
const lastPushFor = (key: string) => {
  const calls = persistSetting.mock.calls.filter((c) => (c as unknown[])[0] === key);
  if (calls.length === 0) return null;
  return JSON.parse((calls[calls.length - 1] as unknown[])[1] as string);
};

describe('POSView durable lists — a fresh device must never overwrite the cloud', () => {
  beforeEach(() => {
    localStorage.clear();
    // English UI so the assertions read against stable labels.
    localStorage.setItem('brewmaster_language', 'en');
    persistSetting.mockClear();
    resetSettingsHydrationForTests();
  });

  afterEach(() => {
    cleanup();
  });

  it('pushes NOTHING on mount when localStorage is empty (the wipe scenario)', async () => {
    renderPOS();
    await settle();

    expect(pushedKeys()).toEqual([]);
  });

  it('pushes nothing on mount when localStorage already holds the real lists', async () => {
    localStorage.setItem('pos_tables_list', JSON.stringify(CLOUD_TABLES));
    localStorage.setItem('pos_staff_list', JSON.stringify(CLOUD_STAFF));

    renderPOS();
    await settle();

    expect(pushedKeys()).toEqual([]);
  });

  it('adopts the cloud lists when hydration lands, without pushing them back', async () => {
    renderPOS();
    await settle();

    await act(async () => {
      cloudHydrateArrives();
      await Promise.resolve();
    });

    // Dine-in surfaces the table chips.
    fireEvent.click(screen.getByRole('button', { name: 'Dine-in' }));
    for (const name of CLOUD_TABLES) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    // Default "1".."8" are gone — the device took the cloud copy.
    expect(screen.queryByRole('button', { name: '7' })).toBeNull();
    expect(pushedKeys()).toEqual([]);
  });

  it('pushes only after a real user edit, and pushes the CLOUD list plus the edit', async () => {
    renderPOS();
    await settle();
    await act(async () => {
      cloudHydrateArrives();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dine-in' }));
    const input = screen.getByPlaceholderText('Enter Table Number');
    fireEvent.change(input, { target: { value: 'شرفة' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();

    expect(lastPushFor('pos_tables_list')).toEqual([...CLOUD_TABLES, 'شرفة']);
    // The staff list was never touched by the operator, so it was never pushed.
    expect(pushedKeys()).not.toContain('pos_staff_list');
  });

  it('replays an edit made BEFORE hydration onto the cloud list, not onto the defaults', async () => {
    renderPOS();
    await settle();

    // Operator is fast: adds a table while the settings read is still in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Dine-in' }));
    const input = screen.getByPlaceholderText('Enter Table Number');
    fireEvent.change(input, { target: { value: 'شرفة' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();

    // Nothing may leave the device while the cloud copy is unknown.
    expect(pushedKeys()).toEqual([]);

    await act(async () => {
      cloudHydrateArrives();
      await Promise.resolve();
    });
    await settle();

    // The edit is replayed as an INTENT on top of the real list — the defaults
    // this device started from are never uploaded.
    expect(lastPushFor('pos_tables_list')).toEqual([...CLOUD_TABLES, 'شرفة']);
  });

  it('still lets the operator delete a table (deletion is a real intent)', async () => {
    localStorage.setItem('pos_tables_list', JSON.stringify(CLOUD_TABLES));
    renderPOS();
    await settle();
    await act(async () => {
      markSettingsHydrationSettled(true);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dine-in' }));
    // Open the manage-tables sheet and remove "tea".
    fireEvent.click(screen.getAllByTitle('Manage Tables')[0]);
    // The sheet lists the tables in order; "tea" is the fourth.
    fireEvent.click(screen.getAllByTitle('Delete')[CLOUD_TABLES.indexOf('tea')]);
    await settle();

    expect(lastPushFor('pos_tables_list')).toEqual(['وي', 'التعاون', 'Engaz', 'Tech']);
  });
});
