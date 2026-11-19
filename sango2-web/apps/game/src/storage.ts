import { readSession, type Session } from '@sango2/core';
import type { GameContent } from '@sango2/content';

export interface SaveSlot { slot: number; revision: number; savedAt: string; session: Session }
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('sango2-web', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'slot' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('存档库被其他页面占用，请关闭旧页面后重试。'));
});
export async function listSaves(): Promise<SaveSlot[]> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('saves', 'readonly');
    const request = tx.objectStore('saves').getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function saveGame(slot: number, session: Session, revision: number): Promise<SaveSlot> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('saves', 'readwrite');
    const store = tx.objectStore('saves');
    const request = store.get(slot);
    const result = { slot, revision: revision + 1, savedAt: new Date().toISOString(), session };
    let conflict = false;
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== revision) { conflict = true; tx.abort(); return; }
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(new Error(conflict ? '此存档已被另一个页面更新。请重新打开存档面板后再操作。' : '保存失败，原存档未被覆盖。'));
    tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
export function exportGame(session: Session) {
  const blob = new Blob([JSON.stringify({ format: 'sango2-web-save', savedAt: new Date().toISOString(), session }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `sango2-${session.scenarioId}-day-${session.day}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importGame(file: File, content: GameContent): Promise<Session> {
  if (file.size > 2_000_000) throw new Error('存档过大，请选择本先行版导出的 JSON 文件。');
  const value = JSON.parse(await file.text());
  if (value?.format !== 'sango2-web-save') throw new Error('这不是 Web 先行版的存档。');
  return readSession(value.session, content);
}
