import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { digest } from '../lib/values.js';

const execute = promisify(execFile);
export class NativeReader {
  constructor(
    root,
    {
      source = fileURLToPath(new URL('../../native/text-reader.swift', import.meta.url)),
      binaryPath = '',
      allowCompile = false,
      platform = process.platform,
      arch = process.arch,
    } = {},
  ) {
    this.root = join(root, 'modules', 'native-cache');
    this.source = source;
    this.binaryPath = binaryPath;
    this.allowCompile = allowCompile;
    this.platform = platform;
    this.arch = arch;
    this.building = null;
  }
  async availability() {
    if (this.platform !== 'darwin')
      return {
        available: false,
        reason: '本机图片识别和 PDF 提取目前支持 macOS；仍可导入文字、字幕及网页正文。',
      };
    const path =
      this.binaryPath ||
      fileURLToPath(new URL('../../native/bin/darwin-' + this.arch + '/text-reader', import.meta.url));
    try {
      await access(path, 1);
      return { available: true, path, prebuilt: true };
    } catch {}
    if (this.allowCompile)
      return { available: true, prebuilt: false, reason: '开发模式：首次使用将调用 Swift 编译器' };
    return {
      available: false,
      reason:
        '未找到本机识别组件，请安装包含 macOS 识别程序的正式发布包。源码开发可运行 npm run build:native。',
    };
  }
  async binary() {
    const available = await this.availability();
    if (!available.available) throw new Error(available.reason);
    if (available.path) return available.path;
    if (this.building) return this.building;
    this.building = (async () => {
      const source = this.source;
      const hash = digest(await readFile(source, 'utf8')).slice(0, 16),
        bin = join(this.root, 'text-reader-' + process.arch + '-' + hash);
      try {
        await access(bin);
        return bin;
      } catch {}
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      try {
        await execute(
          '/usr/bin/swiftc',
          [source, '-O', '-o', bin, '-framework', 'Vision', '-framework', 'AppKit', '-framework', 'PDFKit'],
          { timeout: 120000, maxBuffer: 1000000 },
        );
      } catch {
        throw new Error('本机识别组件未能编译，请确认 macOS 命令行开发工具可用');
      }
      return bin;
    })();
    try {
      return await this.building;
    } catch (error) {
      this.building = null;
      throw error;
    }
  }
  async read(bytes, { kind = 'image', crop = null, signal } = {}) {
    signal?.throwIfAborted();
    const bin = await this.binary(),
      dir = await mkdtemp(join(tmpdir(), 'studyboard-read-')),
      path = join(dir, kind === 'pdf' ? 'input.pdf' : 'input.image');
    try {
      await writeFile(path, bytes, { mode: 0o600 });
      const { stdout } = await execute(bin, [kind, path, ...(crop ? [JSON.stringify(crop)] : [])], {
        timeout: 90000,
        maxBuffer: 4000000,
        signal,
      });
      const value = JSON.parse(stdout);
      if (value.error) throw new Error(value.error);
      return value;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new Error('文字识别失败：' + (error.message || '图片无法读取'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
