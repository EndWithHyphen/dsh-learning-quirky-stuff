import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
  dataDir: Schema.string().default('').description('笔记存储目录；留空使用 DSH 用户数据目录'),
  captureEnabled: Schema.boolean().default(true).description('允许连接本机浏览器扩展'),
  capturePort: Schema.number().min(1024).max(65535).default(43127).description('浏览器连接端口'),
  nativeReaderPath: Schema.string().default('').description('自定义本机识别程序；留空使用随包提供的程序'),
  allowNativeCompile: Schema.boolean()
    .default(false)
    .description('开发用途：缺少预编译程序时允许调用 Swift 编译器'),
});
export function normalizeConfig(value = {}) {
  const result = {
    dataDir: '',
    captureEnabled: true,
    capturePort: 43127,
    nativeReaderPath: '',
    allowNativeCompile: false,
    ...value,
  };
  if (typeof result.dataDir !== 'string' || typeof result.nativeReaderPath !== 'string')
    throw new Error('存储目录或识别程序路径不正确');
  if (!Number.isInteger(result.capturePort) || result.capturePort < 1024 || result.capturePort > 65535)
    throw new Error('浏览器端口必须是 1024～65535 之间的整数');
  if (typeof result.captureEnabled !== 'boolean' || typeof result.allowNativeCompile !== 'boolean')
    throw new Error('功能配置必须为布尔值');
  return result;
}
