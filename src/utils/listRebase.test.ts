import { describe, it, expect } from 'vitest';
import { rebaseList, listsEqual } from './listRebase';

const CLOUD = ['وي', 'التعاون', 'Engaz', 'tea', 'Tech'];
const DEFAULTS = ['1', '2', '3', '4', '5', '6', '7', '8'];

describe('rebaseList — replaying a device edit onto the cloud copy', () => {
  it('adopts the cloud list when the device made no edits', () => {
    expect(rebaseList(DEFAULTS, DEFAULTS, CLOUD)).toEqual(CLOUD);
  });

  it('never uploads the defaults a device started from', () => {
    // Fresh till: seeded with defaults, operator added one table before the
    // hydrate landed. Only the addition survives the rebase.
    const local = [...DEFAULTS, 'شرفة'];
    expect(rebaseList(DEFAULTS, local, CLOUD)).toEqual([...CLOUD, 'شرفة']);
  });

  it('honours a deletion — that is a real intent', () => {
    const local = CLOUD.filter((t) => t !== 'tea');
    expect(rebaseList(CLOUD, local, CLOUD)).toEqual(['وي', 'التعاون', 'Engaz', 'Tech']);
  });

  it('honours a deliberate clear-all', () => {
    expect(rebaseList(CLOUD, [], CLOUD)).toEqual([]);
  });

  it('keeps cloud entries this device never knew about', () => {
    const cloudPlus = [...CLOUD, 'روف'];
    const local = [...CLOUD, 'شرفة'];
    expect(rebaseList(CLOUD, local, cloudPlus)).toEqual([...cloudPlus, 'شرفة']);
  });

  it('does not duplicate an item the cloud already added', () => {
    const local = [...CLOUD, 'شرفة'];
    const cloudPlus = [...CLOUD, 'شرفة'];
    expect(rebaseList(CLOUD, local, cloudPlus)).toEqual(cloudPlus);
  });

  it('treats an empty cloud list as empty, adding only what this device added', () => {
    expect(rebaseList([], ['أحمد'], [])).toEqual(['أحمد']);
    expect(rebaseList([], [], [])).toEqual([]);
  });
});

describe('listsEqual', () => {
  it('compares order-sensitively', () => {
    expect(listsEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(listsEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(listsEqual(['a'], ['a', 'b'])).toBe(false);
    expect(listsEqual([], [])).toBe(true);
  });
});
