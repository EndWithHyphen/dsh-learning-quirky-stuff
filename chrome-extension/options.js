import { connection, request, pairRequest, PROTOCOL } from './bridge.js';
const status = document.querySelector('#status'),
  check = document.querySelector('#check'),
  portInput = document.querySelector('#port');
let stopped = false;
window.addEventListener('pagehide', () => {
  stopped = true;
});
async function checkConnection() {
  try {
    const c = await connection();
    if (c) {
      portInput.value = c.port;
      await request('/verify');
      status.textContent = '已连接。可以用快捷键打开当前页笔记。';
      return true;
    }
  } catch {}
  status.textContent = '首次连接：点击下方按钮，再到 DSH「学习画板 → 浏览器快捷笔记」确认。';
  return false;
}
check.addEventListener('click', async () => {
  check.disabled = true;
  try {
    const port = Number(portInput.value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('请输入有效端口');
    if (
      port !== 43127 &&
      chrome.permissions &&
      !(await chrome.permissions.request({ origins: [`http://127.0.0.1:${port}/*`] }))
    )
      throw new Error('需要允许访问你设置的本机端口');
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    let value = await pairRequest(port, '/pair/start', { secret, protocol: PROTOCOL });
    status.textContent = '请到 DSH「学习画板 → 浏览器快捷笔记」点击「允许连接」。';
    while (!stopped && value.status === 'pending') {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (stopped) return;
      value = await pairRequest(port, '/pair/poll', { id: value.id, secret });
    }
    if (stopped) return;
    if (value.status !== 'approved') throw new Error('DSH 未允许本次连接，可以重新发起');
    await chrome.storage.local.set({
      bridgeConnection: { port, token: value.token, clientId: value.clientId, protocol: PROTOCOL },
    });
    await chrome.runtime.sendMessage({ action: 'flush' });
    status.textContent = '已连接并记住此浏览器，以后打开 DSH 会自动连接。';
  } catch (error) {
    status.textContent = error.message.includes('fetch')
      ? '无法连接本机 DSH，请打开应用并确认端口。'
      : error.message;
  } finally {
    check.disabled = false;
  }
});
checkConnection();
document.querySelector('#extension-id').textContent = chrome.runtime.id;
document.querySelector('#shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
chrome.storage.local.get('lastPanelError').then((v) => {
  document.querySelector('#panel-status').textContent = v.lastPanelError || '';
});
