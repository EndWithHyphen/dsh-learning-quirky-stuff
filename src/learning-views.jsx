import React, { useEffect, useMemo, useState } from 'react';
import { useLearning } from './features/context.jsx';
import { QuestionCard } from './study-panel.jsx';
const B = ({ children, primary = false, ...p }) => (
  <button {...p} className={`sb-button ${primary ? 'sb-primary' : ''} ${p.className || ''}`}>
    {children}
  </button>
);
function interval(value) {
  const mins = Math.max(1, Math.round((new Date(value) - Date.now()) / 60000));
  return mins < 60
    ? `${mins} 分钟`
    : mins < 1440
      ? `${Math.round(mins / 60)} 小时`
      : `${Math.round(mins / 1440)} 天`;
}
const date = (s) =>
  new Date(s).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ReviewView({ api, onError, onOpen, onChanged }) {
  const moduleUI = useLearning();
  const [data, setData] = useState(null),
    [skip, setSkip] = useState(new Set()),
    [preview, setPreview] = useState([]),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [retention, setRetention] = useState(0.9),
    [limit, setLimit] = useState(20),
    [reminder, setReminder] = useState(false),
    [hour, setHour] = useState(20),
    [notice, setNotice] = useState(''),
    [dismissed, setDismissed] = useState(null);
  const reload = () =>
    api('execute', { action: 'reviewDashboard' })
      .then((d) => {
        setData(d);
        setRetention(d.settings.retention);
        setLimit(d.settings.dailyLimit);
        setReminder(d.settings.reminderEnabled);
        setHour(d.settings.reminderHour);
        onChanged?.(d.dueCount);
      })
      .catch(onError);
  useEffect(() => {
    reload();
  }, []);
  const card = data?.cards.find((c) => !skip.has(c.id));
  useEffect(() => {
    if (card) api('execute', { action: 'reviewPreview', cardId: card.id }).then(setPreview).catch(onError);
  }, [card?.id, card?.version]);
  async function grade(value, answer) {
    setBusy(true);
    try {
      const r = await api('execute', {
        action: 'review',
        cardId: card.id,
        version: card.version,
        grade: value,
        answer,
        eventId: crypto.randomUUID(),
      });
      setDismissed(null);
      setNotice(`下次复习：${date(r.card.schedule.dueAt)}`);
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function suspend(cardId, suspended) {
    setBusy(true);
    try {
      await api('execute', { action: 'suspendReview', cardId, suspended });
      setDismissed(suspended ? cardId : null);
      setNotice(suspended ? '这张卡已设为不再出现' : '这张卡已恢复复习');
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings() {
    setBusy(true);
    try {
      let enabled = reminder;
      if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        enabled = (await Notification.requestPermission()) === 'granted';
        if (!enabled) setNotice('系统未允许通知，到期任务仍会显示在复习队列中。');
      }
      await api('execute', {
        action: 'learningSettings',
        retention: Number(retention),
        dailyLimit: Number(limit),
        reminderEnabled: enabled,
        reminderHour: Number(hour),
      });
      setSettings(false);
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <div className="sb-loading">正在准备复习…</div>;
  return (
    <section className="sb-learning-page">
      <header className="sb-page-title">
        <div>
          <span className="sb-eyebrow">RECALL / 主动回忆</span>
          <h1>把知识留得更久</h1>
          <p>先回忆，再核对。根据你的反馈安排下一次复习。</p>
        </div>
        <B onClick={() => setSettings((v) => !v)}>复习设置</B>
      </header>
      <div className="sb-review-stats">
        <div>
          <strong>{data.dueCount}</strong>
          <span>当前到期</span>
        </div>
        <div>
          <strong>{data.completedToday}</strong>
          <span>今日已练习</span>
        </div>
        <div>
          <strong>{data.total}</strong>
          <span>复习卡片</span>
        </div>
        <div>
          <strong>{Math.round(data.settings.retention * 100)}%</strong>
          <span>记忆目标</span>
        </div>
      </div>
      {settings && (
        <section className="sb-review-settings">
          <label>
            记忆目标 {Math.round(retention * 100)}%
            <input
              type="range"
              min="0.8"
              max="0.97"
              step="0.01"
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
          </label>
          <p>目标越高，复习越频繁。这里是模型估计，随反馈调整。</p>
          <label>
            每轮最多卡片
            <input type="number" min="1" max="200" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <label className="sb-check-label">
            <input type="checkbox" checked={reminder} onChange={(e) => setReminder(e.target.checked)} />
            每天提醒有到期任务
          </label>
          <label>
            提醒时间
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <p>桌面提醒在 DSH 与学习画板运行时生效，未打开时会在下次进入显示到期任务。</p>
          <B primary disabled={busy} onClick={saveSettings}>
            保存设置
          </B>
          {data.suspended?.length > 0 && (
            <details className="sb-suspended-cards">
              <summary>不再出现的卡片 · {data.suspended.length}</summary>
              {data.suspended.map((c) => (
                <div key={c.id}>
                  <span>
                    <strong>{c.question}</strong>
                    <small>{c.boardTitle}</small>
                  </span>
                  <B disabled={busy} onClick={() => suspend(c.id, false)}>
                    恢复复习
                  </B>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      {notice && (
        <div role="status" className="sb-success-note sb-review-notice">
          <span>{notice}</span>
          {dismissed && (
            <B disabled={busy} onClick={() => suspend(dismissed, false)}>
              撤销
            </B>
          )}
        </div>
      )}
      {card ? (
        <div className="sb-review-layout">
          <div>
            <div className="sb-review-source">
              <span>来自 {card.boardTitle}</span>
              <button
                onClick={() =>
                  card.origin
                    ? moduleUI.navigation.current.openFeature?.(card.origin.feature, {
                        reportId: card.origin.id,
                      })
                    : onOpen(card.boardId, card.summaryId)
                }
              >
                {card.origin ? '回到整理结果 ↗' : '回到原笔记 ↗'}
              </button>
            </div>
            <QuestionCard
              key={`${card.id}/${card.version}`}
              question={{
                prompt: card.question,
                context: card.context,
                tasks: card.tasks,
                answer: card.answer,
                hint: card.hint,
                checkpoints: card.checkpoints,
                difficulty: card.difficulty,
                kind: card.kind,
              }}
              footer={(answer) => (
                <div className="sb-grades">
                  <p>这次回忆起来怎样？</p>
                  <div>
                    {[
                      [1, '忘了'],
                      [2, '有点模糊'],
                      [3, '掌握'],
                      [4, '很轻松'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        disabled={busy}
                        className={`sb-grade sb-grade-${value}`}
                        onClick={() => grade(value, answer)}
                      >
                        <strong>{label}</strong>
                        <small>
                          {preview.find((p) => p.grade === value)
                            ? interval(preview.find((p) => p.grade === value).due)
                            : ''}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            />
            <div className="sb-review-skip">
              <B onClick={() => setSkip((v) => new Set([...v, card.id]))}>这张稍后再看</B>
              <B className="sb-review-dismiss" disabled={busy} onClick={() => suspend(card.id, true)}>
                不再出现
              </B>
            </div>
          </div>
          <aside>
            <h3>本轮待复习</h3>
            {data.cards
              .filter((c) => !skip.has(c.id))
              .slice(0, 8)
              .map((c) => (
                <div className={c.id === card.id ? 'active' : ''} key={c.id}>
                  <span>{c.question}</span>
                  <small>{c.boardTitle}</small>
                </div>
              ))}
          </aside>
        </div>
      ) : (
        <div className="sb-review-complete">
          <span>✓</span>
          <h2>{data.total ? '这一轮完成了' : '从一张自测卡开始'}</h2>
          <p>
            {data.total
              ? '新的到期任务会在这里出现。'
              : '在AI总结中点击「加入复习」，知识会按掌握程度重新出现。'}
          </p>
          {skip.size > 0 && (
            <B
              onClick={() => {
                setSkip(new Set());
                reload();
              }}
            >
              查看刚才跳过的卡片
            </B>
          )}
        </div>
      )}
      {data.upcoming.length > 0 && (
        <section className="sb-upcoming">
          <h3>接下来</h3>
          {data.upcoming.slice(0, 6).map((c) => (
            <div key={c.id}>
              <span>{c.title}</span>
              <time>{date(c.due)}</time>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
export { default as GraphView } from './spo-graph-view.jsx';
export function CaptureView({ api, onError }) {
  const [info, setInfo] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api('captureInfo')
        .then((value) => {
          if (!stopped) setInfo(value);
        })
        .catch(onError);
    load();
    const timer = setInterval(load, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  async function pairing(action, id) {
    setBusy(true);
    try {
      await api('capturePairing', { action, id });
      setInfo(await api('captureInfo'));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sb-learning-page sb-capture-page">
      <header className="sb-page-title">
        <div>
          <span className="sb-eyebrow">CAPTURE / 浏览器快捷笔记</span>
          <h1>边看边记，留住理解</h1>
          <p>快捷键打开当前网页的笔记。可在侧栏或网页底部记录、画图和截图，自动同步到学习画板。</p>
        </div>
      </header>
      <div className="sb-shortcut-hero">
        <kbd>⌘</kbd>
        <span>+</span>
        <kbd>Shift</kbd>
        <span>+</span>
        <kbd>Y</kbd>
      </div>
      <section className="sb-capture-card">
        <h2>连接本机 Chrome</h2>
        <p>
          安装配套扩展，打开扩展设置并点「连接本机 DSH」，然后在这里允许连接。之后会自动连接，无需输入连接码。
        </p>
        <p className="sb-success-note">
          {info?.enabled ? '本机连接已就绪 · 端口 ' + info.port : '本机连接未启动'}
        </p>
        {info?.error && <p className="sb-notice">{info.error}</p>}
        {(info?.pending || []).map((item) => (
          <div className="sb-browser-connection" key={item.id}>
            <strong>浏览器正在请求连接</strong>
            <p>
              扩展 ID：<code>{item.extensionId}</code>
            </p>
            <p>允许后，此扩展可以创建、读取和编辑学习笔记。请与扩展设置页显示的 ID 核对。</p>
            <B disabled={busy} onClick={() => pairing('approve', item.id)}>
              允许连接
            </B>{' '}
            <B disabled={busy} onClick={() => pairing('reject', item.id)}>
              拒绝
            </B>
          </div>
        ))}
        <h3>已连接的浏览器</h3>
        {info?.clients?.length ? (
          info.clients.map((client) => (
            <div className="sb-browser-connection" key={client.id}>
              <p>
                Chrome 扩展 <code>{client.extensionId}</code>
              </p>
              <B disabled={busy} onClick={() => pairing('revoke', client.id)}>
                断开此连接
              </B>
            </div>
          ))
        ) : (
          <p>尚未连接浏览器。</p>
        )}
      </section>
      <section className="sb-capture-card">
        <h3>只收下你选择的这一页</h3>
        <p>
          快捷键和扩展图标打开侧栏；点击「底部打开」可从网页下方展开，并拖动顶部边缘调整高度。同一网页再次使用会打开原笔记；支持区域截图、可见页截图和粘贴图片。DSH
          暂不可用时，草稿保存在 Chrome。
        </p>
        <p>快捷键可在 Chrome 的「扩展程序 → 键盘快捷键」里修改。</p>
      </section>
    </section>
  );
}
