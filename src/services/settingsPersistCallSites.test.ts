import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Audit guard: no durable setting may be pushed from a mount-time effect.
 *
 * `persistSetting` inside `useEffect(..., [value])` looks like "sync on change",
 * but React runs that effect on MOUNT too. On a device with an empty
 * localStorage the mounted value is the hard-coded DEFAULT, so the effect
 * uploaded defaults over the shop's real data with a fresh timestamp — which is
 * how the table and staff lists were wiped in production on 2026-08-03.
 *
 * Every other call site (MenuModal, PinSetupModal, LanguageContext,
 * settingsConfig) sits inside an event handler, i.e. behind a human action.
 * This test keeps it that way.
 */
const SRC = resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Extract the source of every `useEffect(` / `useLayoutEffect(` call body. */
function effectBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /use(?:Layout)?Effect\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(start, i + 1));
  }
  return blocks;
}

const files = walk(SRC);

describe('persistSetting call-site audit', () => {
  it('finds no persistSetting inside any effect, anywhere in the app', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('persistSetting')) continue;
      for (const block of effectBlocks(src)) {
        if (block.includes('persistSetting')) {
          offenders.push(relative(SRC, file));
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('POSView no longer pushes its lists itself — it goes through the gated hook', () => {
    const src = readFileSync(join(SRC, 'components/orders/POSView.tsx'), 'utf8');
    expect(src).not.toContain('persistSetting');
    expect(src).toContain('useCloudBackedList');
  });

  it('the remaining call sites are the audited, handler-bound ones', () => {
    const withCalls = files
      .filter((f) => /\bpersistSetting\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).replace(/\\/g, '/'))
      .sort();

    expect(withCalls).toEqual([
      'components/menu/MenuModal.tsx',
      'components/settings/PinSetupModal.tsx',
      'context/LanguageContext.tsx',
      'hooks/useCloudBackedList.ts',
      'services/settingsCloudService.ts',
      'utils/settingsConfig.ts',
    ]);
  });

  it('the hook only pushes from its operator-edit path, never on mount', () => {
    const src = readFileSync(join(SRC, 'hooks/useCloudBackedList.ts'), 'utf8');
    // The single push lives in `commit`, which is only reached with persist=true
    // from setList (a human) or the hydration replay (a human's earlier edit).
    const pushes = src.match(/persistSetting\(/g) || [];
    expect(pushes).toHaveLength(1);
    expect(src).toContain('if (persist) void persistSetting(key, JSON.stringify(next));');
  });
});
