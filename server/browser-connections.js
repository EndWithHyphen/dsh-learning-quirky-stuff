import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { atomicWrite } from '../core.js';
import { BRIDGE_PROTOCOL } from '../shared/identity.js';
const secretHash = (value) =>
  createHash('sha256')
    .update(String(value || ''))
    .digest();
const equal = (a, b) => timingSafeEqual(secretHash(a), secretHash(b));
const originId = (origin) =>
  /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '') ? origin.slice(19) : null;
export class BrowserConnections {
  constructor(server, { now = Date.now } = {}) {
    this.server = server;
    this.now = now;
    this.pending = new Map();
  }
  init(legacy) {
    const config = this.server.config;
    config.clients ||= [];
    if (!Array.isArray(config.clients)) throw new Error('浏览器连接记录损坏');
    config.legacyTokenAllowed ??= legacy;
    config.version = 2;
  }
  prune() {
    for (const [id, item] of this.pending) if (item.expiresAt <= this.now()) this.pending.delete(id);
  }
  list() {
    this.prune();
    return {
      pending: [...this.pending.values()]
        .filter((p) => p.status === 'pending')
        .map(({ id, extensionId, expiresAt }) => ({ id, extensionId, expiresAt })),
      clients:
        this.server.config?.clients?.map(({ id, extensionId, createdAt }) => ({
          id,
          extensionId,
          createdAt,
        })) || [],
    };
  }
  authorized(req) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return false;
    const origin = req.headers.origin,
      config = this.server.config;
    if (!origin) return equal(token, config.token); // Local diagnostics use the private host token.
    if (config.clients.some((c) => c.origin === origin && equal(c.token, token))) return true;
    return config.legacyTokenAllowed && equal(token, config.token);
  }
  mutate(fn) {
    const server = this.server;
    const work = server.tail.then(async () => {
      const configBefore = structuredClone(server.config),
        pendingBefore = new Map([...this.pending].map(([id, p]) => [id, structuredClone(p)]));
      try {
        const result = await fn();
        await atomicWrite(server.file, server.config);
        return result;
      } catch (error) {
        server.config = configBefore;
        this.pending = pendingBefore;
        throw error;
      }
    });
    server.tail = work.catch(() => {});
    return work;
  }
  async approve(id) {
    return this.mutate(() => {
      this.prune();
      const item = this.pending.get(id);
      if (!item || item.status !== 'pending') throw new Error('连接请求已过期，请在浏览器中重试');
      const client = {
        id: randomBytes(12).toString('hex'),
        origin: item.origin,
        extensionId: item.extensionId,
        token: randomBytes(32).toString('hex'),
        createdAt: new Date(this.now()).toISOString(),
      };
      this.server.config.clients = this.server.config.clients
        .filter((c) => c.origin !== item.origin)
        .concat(client);
      item.status = 'approved';
      item.client = client;
      item.expiresAt = this.now() + 120000;
      return { connected: true };
    });
  }
  reject(id) {
    const item = this.pending.get(id);
    if (item) {
      item.status = 'rejected';
      item.expiresAt = this.now() + 30000;
    }
    return { rejected: true };
  }
  revoke(id) {
    return this.mutate(() => {
      this.server.config.clients = this.server.config.clients.filter((c) => c.id !== id);
      for (const [key, p] of this.pending) if (p.client?.id === id) this.pending.delete(key);
      return { revoked: true };
    });
  }
  start(origin, body) {
    this.prune();
    const extensionId = originId(origin);
    if (!extensionId) throw new Error('请从学习画板 Chrome 扩展发起连接');
    if (body.protocol !== BRIDGE_PROTOCOL) throw new Error('扩展与 DSH 插件版本不兼容，请更新后重试');
    if (!/^[a-f0-9]{64}$/.test(body.secret || '')) throw new Error('连接请求无效');
    for (const item of this.pending.values())
      if (item.origin === origin && equal(item.secretHash, secretHash(body.secret).toString('hex')))
        return { id: item.id, status: item.status, expiresAt: item.expiresAt, protocol: BRIDGE_PROTOCOL };
    if ([...this.pending.values()].filter((p) => p.status === 'pending').length >= 8)
      throw new Error('连接请求较多，请稍后重试');
    const item = {
      id: randomBytes(16).toString('hex'),
      origin,
      extensionId,
      secretHash: secretHash(body.secret).toString('hex'),
      status: 'pending',
      expiresAt: this.now() + 120000,
    };
    this.pending.set(item.id, item);
    return { id: item.id, status: item.status, expiresAt: item.expiresAt, protocol: BRIDGE_PROTOCOL };
  }
  poll(origin, body) {
    this.prune();
    const item = this.pending.get(body.id);
    if (!item || item.origin !== origin || !equal(item.secretHash, secretHash(body.secret).toString('hex')))
      throw new Error('连接请求已过期或不属于当前扩展');
    return {
      id: item.id,
      status: item.status,
      expiresAt: item.expiresAt,
      protocol: BRIDGE_PROTOCOL,
      ...(item.status === 'approved'
        ? { token: item.client.token, clientId: item.client.id, port: this.server.port }
        : {}),
    };
  }
  async migrate(req) {
    const origin = req.headers.origin,
      extensionId = originId(origin),
      token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (
      !extensionId ||
      (!this.server.config.legacyTokenAllowed &&
        !this.server.config.clients.some((client) => client.origin === origin)) ||
      !equal(token, this.server.config.token)
    )
      throw new Error('旧连接已失效，请重新连接');
    return this.mutate(() => {
      const prior = this.server.config.clients.find((c) => c.origin === origin);
      const client = prior || {
        id: randomBytes(12).toString('hex'),
        origin,
        extensionId,
        token: randomBytes(32).toString('hex'),
        createdAt: new Date(this.now()).toISOString(),
      };
      if (!prior) this.server.config.clients.push(client);
      this.server.config.legacyTokenAllowed = false;
      return {
        status: 'approved',
        protocol: BRIDGE_PROTOCOL,
        token: client.token,
        clientId: client.id,
        port: this.server.port,
      };
    });
  }
  async handle(req, res) {
    if (req.method !== 'POST' || !originId(req.headers.origin)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: '请从浏览器扩展发起连接' }));
    }
    if (!['/pair/start', '/pair/poll', '/pair/migrate'].includes(req.url)) {
      res.writeHead(404);
      return res.end();
    }
    try {
      if (!String(req.headers['content-type'] || '').startsWith('application/json'))
        throw new Error('连接请求格式不正确');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) throw new Error('连接请求过大');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result =
        req.url === '/pair/start'
          ? this.start(req.headers.origin, body)
          : req.url === '/pair/poll'
            ? this.poll(req.headers.origin, body)
            : await this.migrate(req);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: error.message }));
    }
  }
}
