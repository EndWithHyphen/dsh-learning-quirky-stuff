let connection;
function db() {
  return (connection ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('dsh-studyboard-drafts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function draftRead(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('drafts').objectStore('drafts').get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function draftPut(id, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put(value, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function draftDelete(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function draftPurge(ids) {
  if (!ids?.length) return;
  const removed = new Set(ids),
    d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('drafts', 'readwrite'),
      store = tx.objectStore('drafts'),
      cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      const key = String(item.key),
        id = key.startsWith('chrome:') ? key.slice(7).split(':')[0] : key.split(':')[0];
      if (removed.has(id)) item.delete();
      item.continue();
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
