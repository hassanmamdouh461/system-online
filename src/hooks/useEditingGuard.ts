import { useContext } from 'react';
import { DataContext } from '../context/DataContext';

/**
 * Lets any modal/form tell the DataContext that the user is actively editing.
 * While true, background refetches (the 15s interval + cloud hydrate) are
 * suppressed so a refresh can never wipe in-progress typing.
 *
 * Returns a function to toggle the guard. Call setEditing(true) when the
 * surface opens and setEditing(false) when it closes.
 */
export function useEditingGuard() {
  const ctx = useContext(DataContext);
  // ctx may be null if used outside DataProvider; fail safe (no-op).
  const setEditing = ctx?.setEditing ?? (() => {});
  return setEditing;
}
