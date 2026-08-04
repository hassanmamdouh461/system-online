import { useState, useEffect, useCallback, useRef } from 'react';
import { CloudOff, ShieldAlert, LogIn, Loader2, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { syncService } from '../../services/syncService';
import {
  getWorkerUrl,
  refreshCloudSessionRole,
  getLastSessionMintOutcome,
} from '../../services/cloudConfig';
import {
  getCloudSessionState,
  subscribeCloudSession,
  reportCloudSessionLost,
  resetCloudSessionState,
  type CloudSessionState,
} from '../../services/cloudSessionState';

/**
 * A persistent strip in the app chrome for the two states in which this device
 * is NOT writing to the cloud.
 *
 * THE OUTAGE THIS SURFACES
 * The Worker session cookie lasts 12 hours. The password that mints it is held
 * in memory only, so after any page refresh this tab cannot re-mint
 * (ensureCloudSession: "No credential ⇒ cannot mint"). The UI session in
 * localStorage, by contrast, never expires. When the cookie finally lapses the
 * cashier keeps working against a fully functional-looking screen while every
 * cloud write returns 401 — orders, edits and deletions accumulate in IndexedDB
 * and are destroyed by the first cache clear. Nothing told anyone.
 *
 * A toast is the wrong instrument for this: it disappears, and the condition
 * lasts for the rest of the shift. This is a fixed bar that stays until the
 * session is genuinely restored.
 *
 * WHY THIS IS A NEIGHBOUR OF SyncStatus, NOT AN EXTENSION OF IT
 * SyncStatus answers "is the queue draining?" and lives inside the Settings
 * page, where nobody stands during service. This answers a different question —
 * "may this device write at all?" — and has to be visible on the POS. It reads
 * `syncService.getHealth()` for connectivity rather than re-deriving it, and
 * owns no queue logic of its own.
 *
 * OFFLINE IS NOT A LOST SESSION
 * Offline is a legitimate, supported state: the till is meant to keep selling
 * and the queue drains later. It gets its own calm, slate-coloured message and
 * never the red one. Only real evidence — a 401 from a write, or a session probe
 * that found nothing while online and configured — raises the red bar.
 */

/** How often to re-probe once we believe the session is gone. */
const PROBE_INTERVAL_MS = 60_000;

export function CloudSessionBanner() {
  const { language } = useLanguage();
  const { refreshCloudSession, user } = useAuth();
  const isRtl = language === 'ar';

  const [sessionState, setSessionState] = useState<CloudSessionState>(getCloudSessionState);
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [configured, setConfigured] = useState(!!getWorkerUrl());

  const [promptOpen, setPromptOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** The operator dismissed the offline strip for this stretch of being offline. */
  const [offlineDismissed, setOfflineDismissed] = useState(false);

  const probingRef = useRef(false);

  useEffect(() => subscribeCloudSession(setSessionState), []);

  /**
   * Ask the Worker whether the cookie is still good.
   *
   * `refreshCloudSessionRole()` returns a role on a live cookie and null on a
   * dead one — but null is also what it returns when offline or unconfigured, so
   * both are ruled out BEFORE the answer is treated as evidence. Getting that
   * wrong would show a cashier working normally offline a red "you are not
   * saving anything" bar, which is both false and alarming.
   */
  const probe = useCallback(async () => {
    if (probingRef.current) return;
    const workerUrl = getWorkerUrl();
    setConfigured(!!workerUrl);
    if (!workerUrl) return;

    let health;
    try {
      health = await syncService.getHealth();
    } catch {
      return;
    }
    setOnline(health.online);
    if (!health.online) {
      // An unreachable Worker proves nothing about the cookie. Drop any earlier
      // verdict rather than keep asserting a loss we can no longer support.
      resetCloudSessionState();
      return;
    }
    setOfflineDismissed(false);

    probingRef.current = true;
    try {
      const role = await refreshCloudSessionRole();
      // A successful probe reports itself alive from inside cloudConfig; only
      // the negative needs recording here.
      if (role === null) reportCloudSessionLost();
    } finally {
      probingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void probe();
    const timer = setInterval(() => void probe(), PROBE_INTERVAL_MS);
    const onOnline = () => {
      setOnline(navigator.onLine);
      void probe();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
  }, [probe]);

  const handleReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await refreshCloudSession(password);
      if (ok) {
        setPromptOpen(false);
        setPassword('');
        // Confirm against the Worker rather than trusting the mint's own word.
        await probe();
        return;
      }
      // Say what actually went wrong instead of always blaming the password —
      // a rate limit or an unreachable Worker is not a typo.
      const outcome = getLastSessionMintOutcome();
      setError(
        outcome.kind === 'rate_limited'
          ? isRtl
            ? 'محاولات كتير — استنى دقيقة وجرّب تاني'
            : 'Too many attempts — wait a minute and try again'
          : outcome.kind === 'unreachable'
            ? isRtl
              ? 'مفيش اتصال بالسيرفر — جرّب لما النت يرجع'
              : 'Server unreachable — try again when the network is back'
            : isRtl
              ? 'كلمة المرور غير صحيحة'
              : 'Incorrect password'
      );
    } catch {
      setError(isRtl ? 'تعذّر تجديد الجلسة' : 'Could not renew the session');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to say on the login screen, or when no cloud is configured at all
  // (SyncStatus already reports an unconfigured Worker, and repeating it here
  // would just be noise on every screen).
  if (!user || !configured) return null;

  const sessionLost = sessionState === 'lost';

  if (!sessionLost && online) return null;
  if (!sessionLost && offlineDismissed) return null;

  // ── Offline: legitimate, expected, and NOT a lost session ─────────────────
  if (!sessionLost) {
    return (
      <div
        role="status"
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full bg-slate-700 text-white px-3 py-2 flex items-center gap-2 text-xs sm:text-sm"
      >
        <CloudOff size={16} className="shrink-0" />
        <p className="flex-1">
          {isRtl
            ? 'شغال أوفلاين — البيع مستمر والتعديلات محفوظة على الجهاز وهترفع لوحدها لما النت يرجع.'
            : 'Working offline — sales continue and changes are saved on this device, and will upload when the network returns.'}
        </p>
        <button
          type="button"
          onClick={() => setOfflineDismissed(true)}
          className="shrink-0 p-1 rounded hover:bg-white/10"
          aria-label={isRtl ? 'إخفاء' : 'Dismiss'}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // ── Session lost: proven, and NOT dismissible ─────────────────────────────
  // No dismiss button on purpose. Every write is failing; letting the operator
  // hide that is exactly how a whole shift's data ends up living only in a cache
  // that is about to be cleared.
  return (
    <div
      role="alert"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="w-full bg-red-600 text-white px-3 py-2 text-xs sm:text-sm"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert size={16} className="shrink-0" />
        <p className="flex-1 min-w-[12rem] font-semibold">
          {isRtl
            ? 'انتهت جلسة السحاب — الجهاز شغال محليًا فقط والتعديلات مش بتتحفظ على السحاب. متمسحش بيانات المتصفح، وسجّل دخول من جديد.'
            : 'Cloud session expired — this device is local-only and changes are NOT being saved to the cloud. Do not clear browser data; sign in again.'}
        </p>
        {!promptOpen && (
          <button
            type="button"
            onClick={() => {
              setPromptOpen(true);
              setError('');
            }}
            className="shrink-0 inline-flex items-center gap-1.5 bg-white text-red-700 font-bold rounded-lg px-3 py-1.5 hover:bg-red-50 active:scale-95 transition-all"
          >
            <LogIn size={14} />
            {isRtl ? 'تسجيل دخول من جديد' : 'Sign in again'}
          </button>
        )}
      </div>

      {promptOpen && (
        <form onSubmit={handleReauth} className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isRtl ? 'كلمة المرور' : 'Password'}
            className="flex-1 min-w-[10rem] rounded-lg px-3 py-1.5 text-gray-900 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={busy || !password.trim()}
            className="inline-flex items-center gap-1.5 bg-white text-red-700 font-bold rounded-lg px-3 py-1.5 disabled:opacity-60 hover:bg-red-50 active:scale-95 transition-all"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            {isRtl ? 'تجديد الجلسة' : 'Renew session'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPromptOpen(false);
              setPassword('');
              setError('');
            }}
            className="p-1.5 rounded hover:bg-white/10"
            aria-label={isRtl ? 'إلغاء' : 'Cancel'}
          >
            <X size={14} />
          </button>
          {error && <p className="w-full text-white/90 font-semibold">{error}</p>}
        </form>
      )}
    </div>
  );
}
