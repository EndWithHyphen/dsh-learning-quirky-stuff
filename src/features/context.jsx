import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { FEATURES } from '../../shared/features.js';

const Context = createContext({ enabled: () => false, navigation: { current: {} }, settings: null });
export const useLearning = () => useContext(Context);

export function LearningProvider({ api, children }) {
  const moduleApi = useCallback(
    (method, ...args) =>
      api(
        method,
        ...args.map((value) =>
          value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value,
        ),
      ),
    [api],
  );
  const [settings, setSettings] = useState(null),
    [capabilities, setCapabilities] = useState(null),
    [models, setModels] = useState([]),
    [modelError, setModelError] = useState(''),
    navigation = useRef({}),
    loadingModels = useRef(null),
    channel = useRef(null);
  const load = useCallback(async () => {
    try {
      setSettings(await api('execute', { action: 'features.get' }));
      api('execute', { action: 'system.capabilities' })
        .then(setCapabilities)
        .catch(() => {});
    } catch {
      setSettings({ features: {}, models: {}, error: '学习模块配置暂时无法读取' });
    }
  }, [api]);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('studyboard-features');
      channel.current.onmessage = load;
    }
    return () => {
      window.removeEventListener('focus', load);
      channel.current?.close();
    };
  }, [load]);
  async function update(change) {
    const value = await api('execute', { action: 'features.update', ...change });
    setSettings(value);
    channel.current?.postMessage({ updated: true });
    return value;
  }
  async function loadModels() {
    if (loadingModels.current) return loadingModels.current;
    loadingModels.current = api('models')
      .then((values) => {
        setModels(values);
        setModelError('');
        return values;
      })
      .catch((error) => {
        setModelError(error.message);
        return [];
      })
      .finally(() => {
        loadingModels.current = null;
      });
    return loadingModels.current;
  }
  return (
    <Context.Provider
      value={{
        api: moduleApi,
        settings,
        capabilities,
        models,
        modelError,
        loadModels,
        update,
        enabled: (id) => settings?.features?.[id] === true,
        navigation,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function ModuleNav({ view, onSelect }) {
  const learning = useLearning();
  return (
    <>
      {FEATURES.filter((feature) => feature.surface !== 'note' && learning.enabled(feature.id)).map(
        (feature) => (
          <button
            key={feature.id}
            className={'sb-nav-row ' + (view === feature.id ? 'active' : '')}
            onClick={() => onSelect(feature.id)}
          >
            <span className="sb-module-symbol" aria-hidden="true">
              {
                { weekly: '◷', topics: '◫', explore: '↗', search: '⌕', preview: '▤', feedback: '✓' }[
                  feature.id
                ]
              }
            </span>
            <span>{feature.title}</span>
          </button>
        ),
      )}
    </>
  );
}

export function FeatureSettings() {
  const learning = useLearning(),
    [busy, setBusy] = useState(''),
    [pending, setPending] = useState({}),
    [error, setError] = useState('');
  async function toggle(id, enabled) {
    setBusy(id);
    setPending({ [id]: enabled });
    setError('');
    try {
      await learning.update({ features: { [id]: enabled } });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy('');
      setPending({});
    }
  }
  return (
    <section className="sb-module-page">
      <header className="sb-module-header">
        <h1>功能设置</h1>
        <p>随时开启或关闭学习工具。关闭后停止相关任务、隐藏入口，已保存的资料保留。</p>
      </header>
      {(error || learning.settings?.error) && <p className="sb-notice">{error || learning.settings.error}</p>}
      {learning.capabilities && (
        <section className="sb-capabilities">
          <h2>本机能力</h2>
          <p>
            图片识别 / PDF 提取：
            {learning.capabilities.ocr.available ? '已就绪' : learning.capabilities.ocr.reason}
          </p>
          <p>
            Codex：
            {learning.capabilities.codex.available
              ? '已找到本机程序，模型列表会检查登录和版本'
              : '未找到本机程序；可使用 DSH 已配置的模型。安装与登录方式见使用说明。'}
          </p>
        </section>
      )}
      <div className="sb-feature-settings">
        {FEATURES.map((feature) => (
          <article key={feature.id}>
            <div>
              <h2>{feature.title}</h2>
              <p>{feature.description}</p>
            </div>
            <label className="sb-feature-switch">
              <input
                type="checkbox"
                aria-label={feature.title}
                checked={pending[feature.id] ?? learning.enabled(feature.id)}
                disabled={!!busy || !!learning.settings?.error}
                onChange={(event) => toggle(feature.id, event.target.checked)}
              />
              <span>
                {busy === feature.id ? '正在保存' : learning.enabled(feature.id) ? '已开启' : '已关闭'}
              </span>
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}
