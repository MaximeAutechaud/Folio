import { describe, it, expect } from 'vitest';
import { backupFileName } from './backup';

describe('backupFileName', () => {
  it('horodate à la seconde, avec zéros de tête', () => {
    expect(backupFileName(new Date(2026, 6, 5, 9, 3, 7)))
      .toBe('folio-backup-2026-07-05_090307.db');
  });

  it('deux instants distincts donnent deux noms distincts', () => {
    const a = backupFileName(new Date(2026, 6, 25, 16, 30, 0));
    const b = backupFileName(new Date(2026, 6, 25, 16, 30, 1));
    expect(a).not.toBe(b);
  });

  it('trie chronologiquement en ordre lexicographique', () => {
    const names = [
      backupFileName(new Date(2026, 11, 31, 23, 59, 59)),
      backupFileName(new Date(2026, 0, 2, 0, 0, 0)),
      backupFileName(new Date(2026, 6, 25, 16, 30, 0)),
    ];
    expect([...names].sort()).toEqual([names[1], names[2], names[0]]);
  });

  it('extension .db et préfixe reconnaissable', () => {
    const name = backupFileName(new Date());
    expect(name.startsWith('folio-backup-')).toBe(true);
    expect(name.endsWith('.db')).toBe(true);
  });
});
