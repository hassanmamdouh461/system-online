/**
 * Merge a device's local edits onto the cloud copy of a durable string list
 * (table names, staff names) once the cloud copy finally arrives.
 *
 * The POS is usable the instant it renders — an operator can add a table before
 * the settings hydrate has come back. Replaying that edit as "upload my whole
 * list" would push a list built on top of the DEFAULTS and wipe the real one.
 * So we replay the INTENT instead: what did this device add, what did it remove,
 * relative to the list it started from.
 *
 *   baseline — the list this device had at mount (localStorage seed or default)
 *   local    — the list after the operator's edits on this device
 *   cloud    — the authoritative list that just hydrated from D1
 *
 * Deletions are honoured (an operator who removes a table means it), additions
 * are appended, and everything else the cloud knows about survives untouched.
 * A device that made no edits simply adopts the cloud list.
 */
export function rebaseList(
  baseline: readonly string[],
  local: readonly string[],
  cloud: readonly string[]
): string[] {
  const baselineSet = new Set(baseline);
  const localSet = new Set(local);

  // No local edits: the cloud is authoritative, full stop.
  const added = local.filter((item) => !baselineSet.has(item));
  const removed = baseline.filter((item) => !localSet.has(item));
  if (added.length === 0 && removed.length === 0) return [...cloud];

  const removedSet = new Set(removed);
  const result = cloud.filter((item) => !removedSet.has(item));
  const seen = new Set(result);
  for (const item of added) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/** Cheap structural equality for the flat string lists this module deals in. */
export function listsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
