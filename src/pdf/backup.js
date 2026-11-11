import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { PDF_CHUNK_BYTES, PDF_MAX_BYTES } from '../../shared/pdf.js';

/** Keep originals once per backup and outside JSON/RPC payloads. */
export async function packageNoteBackup(backup, execute, onProgress = () => {}) {
  const documents = backup.modules?.pdf?.documents || [];
  if (!documents.length)
    return { blob: new Blob([JSON.stringify(backup)], { type: 'application/json' }), extension: 'json' };
  const ids = new Set();
  for (const document of documents) {
    if (
      !/^[a-f0-9]{64}$/.test(document.id) ||
      ids.has(document.id) ||
      !Number.isSafeInteger(document.size) ||
      document.size < 8 ||
      document.size > PDF_MAX_BYTES ||
      document.assetFile !== 'pdfs/' + document.id + '.pdf'
    )
      throw new Error('PDF 备份清单不正确');
    ids.add(document.id);
  }
  const parts = [];
  let resolve, reject;
  const finished = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  finished.catch(() => {});
  const zip = new Zip((error, data, final) => {
    if (error) reject(error);
    else {
      parts.push(data);
      if (final) resolve();
    }
  });
  try {
    const manifest = new ZipPassThrough('backup.json');
    zip.add(manifest);
    manifest.push(strToU8(JSON.stringify(backup)), true);
    for (const [i, document] of documents.entries()) {
      const file = new ZipPassThrough(document.assetFile);
      zip.add(file);
      for (let offset = 0; offset < document.size; offset += PDF_CHUNK_BYTES) {
        const length = Math.min(PDF_CHUNK_BYTES, document.size - offset);
        const result = await execute({ action: 'pdf.backupRead', documentId: document.id, offset, length });
        const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
        if (bytes.length !== length) throw new Error('PDF 备份读取不完整，请重试');
        file.push(bytes, offset + bytes.length === document.size);
        onProgress(
          `正在备份 PDF ${i + 1}/${documents.length} · ${Math.round(((offset + bytes.length) / document.size) * 100)}%`,
        );
      }
    }
    zip.end();
    await finished;
    return { blob: new Blob(parts, { type: 'application/zip' }), extension: 'zip' };
  } catch (error) {
    zip.terminate();
    throw error;
  }
}
