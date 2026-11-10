import { mkdir } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
export async function lockDataDirectory(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    return await lockfile.lock(root, { realpath: true, retries: 0, stale: 30000, update: 10000 });
  } catch (error) {
    if (error.code === 'ELOCKED')
      throw new Error('这份学习笔记正在被另一个 DSH 实例使用。请关闭重复实例；异常退出后等待 30 秒再重试。');
    throw error;
  }
}
