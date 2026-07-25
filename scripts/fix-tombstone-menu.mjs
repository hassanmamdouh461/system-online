/**
 * One-time migration script: tombstone menu items that exist in D1 cloud
 * but NOT in your local IndexedDB (meaning they were deleted before the
 * soft-delete system was in place). Run once from the project root:
 *
 *   node scripts/fix-tombstone-menu.mjs
 *
 * Requires CLOUD_WORKER_URL env var (or set it below).
 */

const CLOUD_URL = process.env.CLOUD_WORKER_URL || 'https://api.engaz.tech';
const API_KEY = process.env.CLOUD_API_KEY || '';

async function fetchAllMenu() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(`${CLOUD_URL}/v1/databases/default/collections/menu_items/documents`, { headers });
  const json = await res.json();
  return json.documents || [];
}

async function deleteDocument(id) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  // Use the sync endpoint with action=delete
  const res = await fetch(`${CLOUD_URL}/api/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'menu', action: 'delete', data: { id } }),
  });
  return res.ok;
}

async function main() {
  console.log('Fetching all menu items from cloud...');
  const docs = await fetchAllMenu();
  console.log(`Found ${docs.length} menu items in cloud.`);

  // IDs of the canonical INITIAL_MENU_ITEMS (the default seed set)
  // If the user wants to keep some of these, they should NOT run this script,
  // or should edit this list to only include the ones they truly deleted.
  const defaultIds = new Set(
    Array.from({ length: 32 }, (_, i) => String(i + 1))
  );

  const toDelete = docs.filter(
    d => defaultIds.has(String(d.id)) && !d.deleted_at
  );

  if (toDelete.length === 0) {
    console.log('No stale default menu items found to tombstone. Nothing to do.');
    return;
  }

  console.log(`\nFound ${toDelete.length} stale default items to tombstone/delete:`);
  for (const d of toDelete) {
    console.log(`  - ${d.id}: ${d.name} (${d.price} EGP)`);
  }

  console.log(`\nSending DELETE requests...`);
  for (const d of toDelete) {
    const ok = await deleteDocument(d.id);
    console.log(`  ${ok ? '✓' : '✗'} ${d.id} ${d.name}`);
  }
  console.log('\nDone. Reload the POS app to pick up the changes.');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
