// @vitest-environment jsdom
/**
 * Regression test: an invoice could be closed with NO staff attribution.
 *
 * Observed in manual testing: a full payment went through without ever picking
 * a staff member, so the order landed with no `cashierName` — no accountability
 * and no per-staff reporting. `buildAccountMeta` only ever attached the name
 * when one happened to be selected (`staff ? { cashierName: staff } : undefined`),
 * and `selectedStaff` is restored from localStorage with no validation.
 *
 * The trap: the staff list can legitimately be EMPTY (a branch that has not
 * added anyone yet). Making selection unconditionally mandatory would lock the
 * till and stop all selling. So the requirement is conditional — enforced only
 * while `staffList.length > 0`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../context/LanguageContext';
import {
  markSettingsHydrationSettled,
  resetSettingsHydrationForTests,
} from '../../services/settingsHydration';
import type { MenuItem } from '../../types/menu';

vi.mock('../../services/settingsCloudService', () => ({
  persistSetting: vi.fn(async () => 'synced'),
  DURABLE_SETTING_KEYS: ['pos_tables_list', 'pos_staff_list'],
  MANAGER_ONLY_SETTING_KEYS: [],
}));

vi.mock('../../services/cloudConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/cloudConfig')>()),
  isCloudConfigured: () => true,
  getSessionRole: () => 'manager',
  refreshCloudSessionRole: async () => 'manager',
  cloudGetCollection: async () => [],
  cloudUpsert: async () => true,
  cloudSyncNow: async () => true,
}));

vi.mock('../../services/companiesService', () => ({
  companiesService: { getAll: vi.fn(async () => []), getById: vi.fn(async () => null) },
}));
vi.mock('../../utils/printReceipts', () => ({ printAllOrderTickets: vi.fn() }));
vi.mock('../payment/CustomerLookupStep', () => ({ CustomerLookupStep: () => null }));

import { POSView } from './POSView';

const MENU: MenuItem[] = [
  { id: 'm1', name: 'Espresso', price: 20, category: 'Coffee', available: true } as MenuItem,
];

const onCreateOrder = vi.fn(async (..._args: any[]) => ({ id: 'order-1' }) as any);

function renderPOS() {
  return render(
    <LanguageProvider>
      <POSView menuItems={MENU} onCreateOrder={onCreateOrder} estimatedOrderNumber="1" />
    </LanguageProvider>
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Get the till into the one state where only the staff guard can block:
 * a takeaway cart holding one item, with cash received covering the total
 * (takeaway has its own "must be paid in full" guard, which would otherwise
 * mask what we are testing).
 */
function readyPaidTakeawayCart() {
  fireEvent.click(screen.getByRole('button', { name: /Espresso/ }));
  // Keypad: 100 EGP received against a 20 EGP espresso.
  fireEvent.click(screen.getByRole('button', { name: '1' }));
  fireEvent.click(screen.getByRole('button', { name: '00' }));
}

describe('staff attribution is required when staff exist', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('brewmaster_language', 'en');
    onCreateOrder.mockClear();
    resetSettingsHydrationForTests();
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    cleanup();
  });

  it('blocks Print & Pay with a clear message while no staff member is selected', async () => {
    localStorage.setItem('pos_staff_list', JSON.stringify(['أحمد', 'سارة']));
    markSettingsHydrationSettled(true);

    renderPOS();
    await settle();
    readyPaidTakeawayCart();

    fireEvent.click(screen.getByRole('button', { name: /Print & Pay/ }));
    await settle();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onCreateOrder).not.toHaveBeenCalled();
  });

  it('lets the sale through once a staff member is picked, and attributes it', async () => {
    localStorage.setItem('pos_staff_list', JSON.stringify(['أحمد', 'سارة']));
    localStorage.setItem('pos_selected_staff', 'أحمد');
    markSettingsHydrationSettled(true);

    renderPOS();
    await settle();
    readyPaidTakeawayCart();

    fireEvent.click(screen.getByRole('button', { name: /Print & Pay/ }));
    await settle();

    expect(onCreateOrder).toHaveBeenCalledTimes(1);
    const accountMeta = onCreateOrder.mock.calls[0][6];
    expect(accountMeta?.cashierName).toBe('أحمد');
  });

  it('does NOT stop the till when the branch has no staff yet', async () => {
    localStorage.setItem('pos_staff_list', JSON.stringify([]));
    markSettingsHydrationSettled(true);

    renderPOS();
    await settle();
    readyPaidTakeawayCart();

    fireEvent.click(screen.getByRole('button', { name: /Print & Pay/ }));
    await settle();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onCreateOrder).toHaveBeenCalledTimes(1);
  });

  it('re-asks when the remembered staff name is no longer on the list', async () => {
    // A name deleted on another device must not keep attributing invoices.
    localStorage.setItem('pos_staff_list', JSON.stringify(['سارة']));
    localStorage.setItem('pos_selected_staff', 'أحمد');
    markSettingsHydrationSettled(true);

    renderPOS();
    await settle();
    readyPaidTakeawayCart();

    fireEvent.click(screen.getByRole('button', { name: /Print & Pay/ }));
    await settle();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onCreateOrder).not.toHaveBeenCalled();
  });
});
