-- Remove orphaned duplicate credential rows from D1 `settings`.
--
-- WHY: the POS client (settingsCloudService.ts → settingDocId) writes login
-- credentials ONLY with id = `global::<key>`, because both keys are in
-- DURABLE_SETTING_KEYS. Older code revisions left behind per-branch rows with
-- id prefixes `main_branch::` and `manager::`. The Worker reads with
-- `WHERE key = ? ORDER BY updated_at DESC LIMIT 1` (auth.ts:343); since every
-- row's updated_at is empty/equal, that ORDER BY is non-deterministic, so the
-- Worker can match the typed password against ANY of the 3 hashes — which is
-- why login silently fails. Deleting the orphans leaves `global::` as the
-- single source of truth the client already writes.
--
-- This deletes ONLY the 4 orphaned credential rows. Business data (orders,
-- menu, inventory, store_config, etc.) is untouched. The `global::` rows are
-- kept and will be (re)seeded next.
DELETE FROM settings
WHERE key IN ('brewmaster_manager_creds_v1', 'brewmaster_admin_creds_v2')
  AND id IN ('main_branch::brewmaster_manager_creds_v1',
             'manager::brewmaster_manager_creds_v1',
             'main_branch::brewmaster_admin_creds_v2',
             'manager::brewmaster_admin_creds_v2');
