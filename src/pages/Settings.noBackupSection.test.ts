/**
 * The Settings screen must not render a "Backup & Restore" section.
 *
 * It was removed from the UI once (#40) but the component and its three
 * service functions were left in the tree "in case it is ever needed again",
 * which meant a one-line import could bring it back and nothing would notice.
 * The operator has since asked for it gone entirely, so this asserts the whole
 * path is absent: no component file, no imports, and no Arabic/English strings
 * left behind in the page.
 *
 * The card's labels were inline literals, not locale keys, so a translation
 * diff would never have caught this either — hence a source-level check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const settings = readFileSync(resolve(root, 'src/pages/Settings.tsx'), 'utf8');
const snapshotService = readFileSync(resolve(root, 'src/services/snapshotService.ts'), 'utf8');

/** Strip comments so prose about the removal is not mistaken for live code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Settings — Backup & Restore section is gone', () => {
  it('the BackupRestoreCard component no longer exists', () => {
    expect(existsSync(resolve(root, 'src/components/settings/BackupRestoreCard.tsx'))).toBe(false);
  });

  it('Settings.tsx does not import or render it', () => {
    expect(code(settings)).not.toContain('BackupRestoreCard');
  });

  it('none of the section labels survive on the Settings page', () => {
    for (const label of [
      'النسخ الاحتياطي والاسترجاع',
      'تصدير نسخة احتياطية',
      'استيراد من ملف',
      'استرجاع من السحابة',
      'Backup & Restore',
    ]) {
      expect(settings).not.toContain(label);
    }
  });

  it('the manual export / import / restore-now entry points are removed', () => {
    for (const fn of ['exportLocalBackup', 'importBackupFromFile', 'restoreLatestSnapshotNow']) {
      expect(code(snapshotService)).not.toContain(`export async function ${fn}`);
    }
  });

  it('automatic backup and the boot-time rescue restore still exist', () => {
    // Removing the UI must not remove the backups themselves.
    expect(code(snapshotService)).toContain('export async function createSnapshot');
    expect(code(snapshotService)).toContain('export function startSnapshotScheduler');
    expect(code(snapshotService)).toContain('export async function restoreFromSnapshotIfNeeded');
    expect(code(snapshotService)).toContain('export async function applySnapshotPayload');
  });
});
