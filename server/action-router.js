export class ActionRouter {
  constructor(config) {
    this.config = config;
    this.handlers = new Map();
  }
  register(action, handler, feature = null) {
    if (this.handlers.has(action)) throw new Error('重复注册操作：' + action);
    this.handlers.set(action, { handler, feature });
  }
  has(action) {
    return this.handlers.has(action);
  }
  async execute(request) {
    if (!request || typeof request.action !== 'string') throw new Error('操作参数不正确');
    const route = this.handlers.get(request.action);
    if (!route) throw new Error('不支持的操作：' + request.action);
    if (route.feature) this.config.assert(route.feature);
    return route.handler(request);
  }
}
