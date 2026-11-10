import { BrowserConnections } from './server/browser-connections.js';
import { BRIDGE_PROTOCOL } from './shared/identity.js';
import { VERSION } from './shared/version.js';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, copyFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './core.js';
export class CaptureServer {
  constructor(store, options = {}) {
    this.store = store;
    this.port = options.port ?? 43127;
    this.connections = new BrowserConnections(this);
    this.error = null;
    this.server = null;
    this.inflight = new Map();
    this.tail = Promise.resolve();
  }
  async start() {
    const file = join(this.store.root, 'capture.json');
    try {
      this.config = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.config = {
        version: 2,
        token: randomBytes(32).toString('hex'),
        requests: {},
        clients: [],
        legacyTokenAllowed: false,
      };
      await atomicWrite(file, this.config);
    }
    if (!/^[a-f0-9]{64}$/.test(this.config.token)) throw new Error('浏览器连接配置损坏');
    this.file = file;
    this.connections.init(this.config.version !== 2);
    this.server = http.createServer((req, res) =>
      this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '创建笔记失败，请检查 DSH 中的学习画板' }));
      }),
    );
    this.server.requestTimeout = 10000;
    this.server.headersTimeout = 10000;
    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.port, '127.0.0.1', resolve);
      });
      this.port = this.server.address().port;
    } catch (e) {
      this.error =
        e.code === 'EADDRINUSE' ? '浏览器连接端口已被占用，请关闭重复的 DSH 实例后重启' : e.message;
    }
  }
  info() {
    return {
      enabled: !!this.server?.listening,
      port: this.port,
      automatic: true,
      protocol: BRIDGE_PROTOCOL,
      ...this.connections.list(),
      error: this.error,
      client: this.clientState || null,
    };
  }
  async close() {
    if (this.server?.listening) {
      this.server.closeAllConnections();
      await new Promise((r) => this.server.close(r));
    }
  }
  async forgetBoards(ids) {
    const removed = new Set(ids),
      work = this.tail.then(async () => {
        if (!this.config) {
          const file = join(this.store.root, 'capture.json');
          try {
            this.config = JSON.parse(await readFile(file, 'utf8'));
            this.file = file;
          } catch (e) {
            if (e.code === 'ENOENT') return;
            throw e;
          }
        }
        this.config.purgedRequests = [
          ...new Set([
            ...(this.config.purgedRequests || []),
            ...Object.entries(this.config.requests)
              .filter(([, v]) => removed.has(v.id))
              .map(([key]) => key),
          ]),
        ];
        this.config.requests = Object.fromEntries(
          Object.entries(this.config.requests).filter(([, v]) => !removed.has(v.id)),
        );
        await atomicWrite(this.file, this.config);
        await copyFile(this.file, this.file + '.bak');
        for (const name of await readdir(this.store.root))
          if (/^capture\.json\..+\.tmp$/.test(name)) await unlink(join(this.store.root, name));
      });
    this.tail = work.catch(() => {});
    return work;
  }
  authorized(req) {
    return this.connections.authorized(req);
  }
  async capture(r) {
    if (typeof r.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(r.requestId))
      throw new Error('请求编号不正确');
    if (typeof r.url !== 'string' || r.url.length > 10000) throw new Error('链接过长');
    if (this.config.purgedRequests?.includes(r.requestId)) {
      const e = new Error('这次收集的笔记已永久删除');
      e.code = 'NOTE_PURGED';
      throw e;
    }
    const existing = this.config.requests[r.requestId];
    if (existing) return existing;
    if (this.inflight.has(r.requestId)) return this.inflight.get(r.requestId);
    const work = this.tail.then(async () => {
      if (this.config.requests[r.requestId]) return this.config.requests[r.requestId];
      const url = new URL(r.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('只支持普通网页');
      let board;
      if (r.reuseId) {
        board = await this.store.read(r.reuseId);
        if (board.deletedAt) {
          const error = new Error('这篇笔记已在回收站，请先恢复');
          error.code = 'NOTE_TRASHED';
          throw error;
        }
        if (board.source?.url !== url.href) throw new Error('笔记来源已变化，请重新打开当前页笔记');
      }
      if (!board && r.reuse) {
        const { boards } = await this.store.all();
        board = boards
          .filter((b) => !b.deletedAt && b.source?.url === url.href)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      }
      const reused = !!board;
      board =
        board ||
        (await this.store.create({
          title: r.title || '网页笔记',
          source: { url: url.href, title: r.title },
        }));
      const value = { id: board.id, title: board.title, url: board.source.url, reused };
      this.config.requests[r.requestId] = value;
      const entries = Object.entries(this.config.requests).slice(-1000);
      this.config.requests = Object.fromEntries(entries);
      await atomicWrite(this.file, this.config);
      return value;
    });
    this.tail = work.catch(() => {});
    this.inflight.set(r.requestId, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(r.requestId);
    }
  }
  async handle(req, res) {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${this.port}`) {
      res.writeHead(403);
      return res.end();
    }
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-z]{32}$/.test(origin)) {
      res.writeHead(403);
      return res.end();
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Studyboard-Protocol');
      res.writeHead(204);
      return res.end();
    }
    if (req.url.startsWith('/pair/')) return this.connections.handle(req, res);
    if (
      req.headers['x-studyboard-protocol'] &&
      Number(req.headers['x-studyboard-protocol']) !== BRIDGE_PROTOCOL
    ) {
      res.writeHead(426);
      return res.end(
        JSON.stringify({ error: '扩展与 DSH 插件版本不兼容，请更新', code: 'BRIDGE_VERSION_MISMATCH' }),
      );
    }
    if (req.url === '/health' && req.method === 'GET')
      return res.end(
        JSON.stringify({ app: 'studyboard', ready: true, version: VERSION, protocol: BRIDGE_PROTOCOL }),
      );
    if (
      ![
        '/capture',
        '/verify',
        '/note/purged',
        '/note/get',
        '/note/save',
        '/note/image',
        '/note/image/get',
        '/note/image/delete',
        '/note/image/restore',
        '/note/canvas/get',
        '/note/canvas/save',
        '/client-event',
        '/module',
      ].includes(req.url) ||
      req.method !== 'POST'
    ) {
      res.writeHead(404);
      return res.end();
    }
    if (!this.authorized(req)) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: '自动连接暂不可用，请打开 DSH 后重试' }));
    }
    if (req.url === '/verify')
      return res.end(
        JSON.stringify({
          app: 'studyboard',
          ready: true,
          version: VERSION,
          protocol: BRIDGE_PROTOCOL,
          client: this.clientState || null,
        }),
      );
    if (!(req.headers['content-type'] || '').startsWith('application/json')) {
      res.writeHead(415);
      return res.end();
    }
    const chunks = [];
    let size = 0;
    const limit =
      req.url === '/module'
        ? 2500000
        : req.url === '/note/canvas/save'
          ? 65_000_000
          : req.url === '/note/image'
            ? 24_000_000
            : req.url === '/note/save'
              ? 300_000
              : 16384;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        res.writeHead(413);
        return res.end(JSON.stringify({ error: '内容超过大小限制' }));
      }
      chunks.push(chunk);
    }
    try {
      const r = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let result;
      if (req.url === '/module') {
        if (
          ![
            'features.get',
            'features.models',
            'system.capabilities',
            'search.recognizeImage',
            'search.confirmImage',
            'materials.capture',
            'materials.get',
            'materials.preview',
            'tasks.get',
            'tasks.cancel',
          ].includes(r.action)
        )
          throw new Error('浏览器不支持这项学习操作');
        if (!this.moduleAction) throw new Error('学习模块暂不可用');
        result = { value: await this.moduleAction(r) };
      }
      if (req.url === '/note/purged')
        result = { ids: [...this.store.purged], requestIds: this.config.purgedRequests || [] };
      if (req.url === '/capture') result = await this.capture(r);
      if (req.url === '/note/get') result = await this.store.dispatch({ ...r, action: 'webNote' });
      if (req.url === '/note/save') result = await this.store.dispatch({ ...r, action: 'saveWebNotes' });
      if (req.url === '/note/image') result = await this.store.dispatch({ ...r, action: 'addWebImage' });
      if (req.url === '/note/image/get') result = await this.store.dispatch({ ...r, action: 'webImage' });
      if (req.url === '/note/image/delete' || req.url === '/note/image/restore')
        result = await this.store.dispatch({
          ...r,
          action: 'setWebImageDeleted',
          deleted: req.url.endsWith('/delete'),
        });
      if (req.url === '/note/canvas/get') result = await this.store.dispatch({ ...r, action: 'webCanvas' });
      if (req.url === '/note/canvas/save')
        result = await this.store.dispatch({ ...r, action: 'saveWebCanvas' });
      if (req.url === '/client-event') {
        if (!['panel-open', 'screenshot-saved'].includes(r.kind)) throw new Error('无效客户端状态');
        this.clientState = {
          kind: r.kind,
          version: String(r.version || '').slice(0, 30),
          seenAt: new Date().toISOString(),
        };
        result = { received: true };
      }
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      res.writeHead(
        e.code === 'NOTE_PURGED' ? 410 : ['NOTE_CONFLICT', 'CANVAS_CONFLICT'].includes(e.code) ? 409 : 400,
      );
      res.end(
        JSON.stringify({
          error: e.message,
          ...(e.code ? { code: e.code } : {}),
          ...(e.latest ? { latest: e.latest } : {}),
        }),
      );
    }
  }
}
