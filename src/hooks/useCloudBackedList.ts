/**
 * A durable string list (table names, staff names) that lives in D1, is cached
 * in localStorage, and is edited from the POS UI.
 *
 * THE RULE THIS HOOK ENFORCES
 * ---------------------------
 * Only a real operator edit may ever be uploaded, and only once this device
 * knows what the cloud holds. Mounting a component is not an edit.
 *
 * The bug it replaces: POSView seeded `tables` / `staffList` from localStorage
 * and pushed them from a `useEffect([tables])`. Effects run on MOUNT, so a till
 * with an empty localStorage uploaded the hard-coded defaults with a fresh
 * timestamp — which beat the older real value under the Worker's freshness
 * guard and wiped the shop's real lists on every device.
 *
 * How the three states are kept apart:
 *   "nothing here yet"      -> seeded from defaults, gate CLOSED, pushes nothing.
 *   "the cloud copy landed" -> adopted silently, still pushes nothing.
 *   "the operator changed it" -> pushed, including a deliberate empty list.
 *
 * An edit made before hydration lands is not lost and is not dangerous either:
 * it is replayed as an INTENT (added / removed items) on top of the cloud list
 * once that arrives — see utils/listRebase.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { persistSetting, type PersistOutcome } from '../services/settingsCloudService';
import { isCloudConfigured } from '../services/cloudConfig';
import {
  getSettingsHydrationState,
  subscribeSettingsHydration,
} from '../services/settingsHydration';
import { listsEqual, rebaseList } from '../utils/listRebase';

/** How often to pick up a list another device changed (hydrate rewrites localStorage). */
const EXTERNAL_POLL_MS = 15000;

type StoredList = {
  list: string[];
  /** Was there a real value in localStorage, or did we fall back to defaults? */
  present: boolean;
};

function readStoredList(key: string, fallback: readonly string[]): StoredList {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    if (raw == null) return { list: [...fallback], present: false };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { list: [...fallback], present: false };
    return { list: parsed.map((item) => String(item)), present: true };
  } catch {
    return { list: [...fallback], present: false };
  }
}

function writeLocal(key: string, list: readonly string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {
    // ignore quota
  }
}

export type CloudBackedList = {
  /** Current list. */
  list: string[];
  /**
   * Apply an OPERATOR edit. Accepts a value or an updater, like setState.
   *
   * Resolves with how the edit actually ended up, so a delete screen can tell
   * "gone from D1" from "queued on this device only" from "your role may not do
   * this". Awaiting it is optional — an addition rarely needs the ceremony — but
   * any REMOVAL should await it, because a removal that never reaches the cloud
   * comes back on the next hydrate.
   */
  setList: (next: string[] | ((prev: string[]) => string[])) => Promise<PersistOutcome>;
  /** May this device push to the cloud yet? (Useful for disabling UI/tests.) */
  canSync: boolean;
};

export function useCloudBackedList(
  key: string,
  defaults: readonly string[]
): CloudBackedList {
  // `defaults` is usually an inline literal; freeze the first one so effects do
  // not re-run on every render.
  const defaultsRef = useRef(defaults);

  const seedRef = useRef<StoredList | null>(null);
  if (seedRef.current === null) {
    seedRef.current = readStoredList(key, defaultsRef.current);
  }
  const seed = seedRef.current;

  const [list, setListState] = useState<string[]>(seed.list);
  /** Current value, readable from callbacks without a stale closure. */
  const listRef = useRef<string[]>(seed.list);
  /** The list this device started from — the base for replaying local edits. */
  const baselineRef = useRef<string[]>(seed.list);
  /** Did a human change the list on this device? Mounting does not count. */
  const editedRef = useRef(false);
  /** Was a real (non-default) value already cached on this device? */
  const seedPresentRef = useRef(seed.present);

  // With no cloud configured there is nothing to lose and nothing to wait for.
  const cloudConfigured = isCloudConfigured();
  const openAtMount = (() => {
    if (!cloudConfigured) return true;
    const { settled, succeeded } = getSettingsHydrationState();
    if (succeeded) return true;
    // A finished-but-failed read is enough only when this device already had a
    // real copy: pushing an edit built on THAT cannot invent data over the cloud.
    return settled && seed.present;
  })();
  const canSyncRef = useRef(openAtMount);
  const [canSync, setCanSync] = useState(openAtMount);

  /**
   * Commit a new value. `persist` decides whether it also leaves the device.
   *
   * WHY THIS RETURNS AN OUTCOME INSTEAD OF void
   * `persistSetting` has always reported a real `PersistOutcome`, but this line
   * used to `void` the call and throw the result away before anyone could read
   * it. Deleting a table or a staff member therefore printed a green "done"
   * unconditionally: the row was gone from the
   * screen and from localStorage, while the cloud write had queued, failed, or
   * been refused outright. `enqueueSettingSync` returns 'forbidden' for a
   * cashier touching a manager-only key, which is a CERTAIN failure — and even
   * that was discarded. Clearing site data then dropped the local copy and the
   * queue, and the next hydrate pulled the deleted table straight back from D1.
   *
   * Returning the outcome is what lets the calling screen say which of the four
   * things actually happened instead of guessing the happy one.
   */
  const commit = useCallback(
    async (next: string[], persist: boolean): Promise<PersistOutcome> => {
      listRef.current = next;
      setListState(next);
      writeLocal(key, next);
      if (!persist) return 'local_only';
      return await persistSetting(key, JSON.stringify(next));
    },
    [key]
  );

  /** Adopt a value that came from elsewhere (cloud / another tab). Never pushes. */
  const adopt = useCallback((next: string[]) => {
    listRef.current = next;
    baselineRef.current = next;
    editedRef.current = false;
    setListState(next);
  }, []);

  // ---- Hydration: adopt the cloud copy, then replay any pending local edit ----
  useEffect(() => {
    const reconcile = () => {
      const { settled, succeeded } = getSettingsHydrationState();
      if (!settled) return;

      if (!succeeded) {
        // The read failed (offline / not authorised). Open the gate only for a
        // device that already held a real list; a defaults-only device stays
        // read-only so it cannot overwrite a cloud copy it has never seen.
        if (!seedPresentRef.current || canSyncRef.current) return;
        canSyncRef.current = true;
        setCanSync(true);
        // Hydration replay, not a live operator action: there is no open dialog
        // to report into. The durable sync queue still owns the retry.
        if (editedRef.current) void commit(listRef.current, true);
        return;
      }

      // Hydrate has written the cloud copy into localStorage.
      const stored = readStoredList(key, defaultsRef.current);
      const current = listRef.current;
      const wasEdited = editedRef.current;
      const gateWasClosed = !canSyncRef.current;

      canSyncRef.current = true;
      setCanSync(true);
      seedPresentRef.current = seedPresentRef.current || stored.present;

      if (!stored.present) {
        // The cloud genuinely has no copy of this list. Do not invent one —
        // only a real edit may create it.
        baselineRef.current = current;
        if (wasEdited && gateWasClosed) void commit(current, true);
        return;
      }

      // Replay this device's edits (if any) on top of the authoritative list.
      const merged = rebaseList(baselineRef.current, current, stored.list);
      baselineRef.current = merged;
      editedRef.current = false;

      const needsPush = wasEdited && gateWasClosed && !listsEqual(merged, stored.list);
      if (!listsEqual(merged, current)) {
        void commit(merged, needsPush);
      } else if (needsPush) {
        void commit(merged, true);
      }
    };

    reconcile();
    return subscribeSettingsHydration(reconcile);
  }, [key, commit]);

  // ---- Another device changed the list: adopt it, never push it back ----
  useEffect(() => {
    const readExternal = () => {
      const stored = readStoredList(key, defaultsRef.current);
      if (!stored.present) return;
      if (listsEqual(stored.list, listRef.current)) return;
      adopt(stored.list);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) readExternal();
    };
    window.addEventListener('storage', onStorage);
    const timer = setInterval(readExternal, EXTERNAL_POLL_MS);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
    };
  }, [key, adopt]);

  /**
   * An operator edit. This is the ONLY path that uploads — and it uploads an
   * empty list just as happily as a full one, because "I removed everyone" is a
   * legitimate thing to say. It is distinguishable from "I have nothing yet"
   * precisely because a human triggered it.
   */
  const setList = useCallback(
    async (next: string[] | ((prev: string[]) => string[])): Promise<PersistOutcome> => {
      const resolved = typeof next === 'function' ? next(listRef.current) : next;
      // A no-op edit never reached the cloud before and must not claim it did.
      if (listsEqual(resolved, listRef.current)) return 'local_only';
      editedRef.current = true;
      // The gate being shut is itself a "this stayed on the device" answer: the
      // edit is held for the hydration replay, not written to D1 right now.
      return await commit(resolved, canSyncRef.current);
    },
    [commit]
  );

  return { list, setList, canSync };
}
