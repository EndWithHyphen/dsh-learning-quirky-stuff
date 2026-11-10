export const PROTOCOL = 2;
let migrating;
const valid = (value) =>
  value &&
  Number.isInteger(value.port) &&
  value.port > 0 &&
  value.port < 65536 &&
  /^[a-f0-9]{64}$/.test(value.token || '') &&
  value.protocol === PROTOCOL;
async function migrateLegacy() {
  let legacy = (await chrome.storage.local.get('pairingCode')).pairingCode;
  if (!legacy) {
    try {
      const r = await fetch(chrome.runtime.getURL('connection.json'), { cache: 'no-store' });
      legacy = (await r.json()).pairingCode;
    } catch {}
  }
  const match = legacy?.match(/^(\d{1,5}):([a-f0-9]{64})$/);
  if (!match) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${Number(match[1])}/pair/migrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + match[2] },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    const value = await r.json();
    if (!r.ok || !valid(value)) return null;
    const connection = { port: value.port, token: value.token, clientId: value.clientId, protocol: PROTOCOL };
    await chrome.storage.local.set({ bridgeConnection: connection });
    await chrome.storage.local.remove('pairingCode');
    return connection;
  } catch {
    return null;
  }
}
export async function connection() {
  const stored = (await chrome.storage.local.get('bridgeConnection')).bridgeConnection;
  if (valid(stored)) return stored;
  if (!migrating)
    migrating = migrateLegacy().finally(() => {
      migrating = null;
    });
  return migrating;
}
export async function request(path, body = {}) {
  const c = await connection();
  if (!c)
    throw Object.assign(new Error('请在扩展设置中连接本机 DSH，并到学习画板确认；无需输入连接码'), {
      code: 'BRIDGE_NOT_PAIRED',
    });
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${c.port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer ' + c.token,
        'X-Studyboard-Protocol': String(PROTOCOL),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        path === '/module' || path === '/note/image' || path.startsWith('/note/canvas/') ? 30000 : 8000,
      ),
    });
  } catch {
    throw new Error('未连接到 DSH。草稿会保留在本机，打开 DSH 后可重试');
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error('DSH 返回了无效响应，请重试');
  }
  if (!response.ok) {
    const error = new Error(value.error || '操作未完成');
    error.code = value.code || (response.status === 401 ? 'BRIDGE_NOT_PAIRED' : undefined);
    error.latest = value.latest;
    if (response.status === 401) await chrome.storage.local.remove('bridgeConnection');
    throw error;
  }
  return value;
}
export async function pairRequest(port, path, body) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('端口必须是 1024～65535 之间的整数');
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '连接请求失败');
  if (value.protocol !== PROTOCOL) throw new Error('请更新 DSH 学习画板与浏览器扩展');
  return value;
}
