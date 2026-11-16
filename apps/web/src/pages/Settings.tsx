import { useEffect, useState } from 'react';
import { useLocale, bi } from '../app/i18n';
import {
  getRuntimeBaseUrl,
  setRuntimeBaseUrl,
  subscribeRuntimeBaseUrl,
} from '../app/runtimeClient';

const scaffoldCommand = [
  'python3 tools/scaffold_flow.py --root .',
  '  --flow-id FLOW-DOC-DEMO-001',
  '  --name-en "Demo Intent Create"',
  '  --name-zh "示例意图创建"',
  '  --owner-service orders-api',
  '  --reads public.orders',
  '  --writes "public.orders:C,public.events:C,public.outbox:C"',
  '  --events-appended DemoIntentCreated',
  '  --idempotency-key client_request_id',
  '  --event-table public.events',
  '  --outbox-table public.outbox',
].join('\n');

const registerCommand = 'cat outputs/scaffold/flow_doc_demo_001/REGISTER.md';

export function SettingsPage() {
  const [locale] = useLocale();
  const [runtimeUrlInput, setRuntimeUrlInput] = useState('');
  const [savedValue, setSavedValue] = useState<string | null>(() => getRuntimeBaseUrl());
  const [statusText, setStatusText] = useState('');
  const [showScaffoldInstructions, setShowScaffoldInstructions] = useState(false);

  useEffect(() => {
    setRuntimeUrlInput(savedValue ?? '');
  }, [savedValue]);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => {
      setSavedValue(value);
    });
  }, []);

  const onSave = () => {
    setRuntimeBaseUrl(runtimeUrlInput);
    const normalized = getRuntimeBaseUrl();
    setSavedValue(normalized);
    setStatusText(normalized ? bi(locale, 'Saved', '已保存') : bi(locale, 'Cleared', '已清空'));
  };

  const onClear = () => {
    setRuntimeBaseUrl('');
    setSavedValue(null);
    setRuntimeUrlInput('');
    setStatusText(bi(locale, 'Cleared', '已清空'));
  };

  return (
    <section className="page">
      <h1>{bi(locale, 'Settings', '设置')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Runtime integration is optional. Viewer remains design-only without a runtime URL.',
          '运行态接入是可选的;未填写 Runtime URL 时看板保持纯设计期模式。',
        )}
      </p>

      <div className="detail-grid">
        <article className="card">
          <h2>{bi(locale, 'Runtime Base URL', '运行态地址')}</h2>
          <p className="subtle">{bi(locale, 'Example', '示例')}: <code>http://localhost:3000</code></p>
          <div className="settings-form">
            <label htmlFor="runtime-base-url">{bi(locale, 'Runtime Base URL', '运行态地址')}</label>
            <input
              id="runtime-base-url"
              type="text"
              placeholder="http://localhost:3000"
              value={runtimeUrlInput}
              onChange={(event) => setRuntimeUrlInput(event.target.value)}
            />
            <div className="settings-form-actions">
              <button type="button" className="crud-btn" onClick={onSave}>
                {bi(locale, 'Save', '保存')}
              </button>
              <button type="button" className="crud-btn settings-btn-secondary" onClick={onClear}>
                {bi(locale, 'Clear', '清空')}
              </button>
            </div>
          </div>
          <p>{bi(locale, 'Current', '当前')}: <code>{savedValue ?? '-'}</code></p>
          {statusText && <p className="subtle">{statusText}</p>}
        </article>

        <article className="card">
          <h2>{bi(locale, 'Flow Scaffolder', '流程脚手架')}</h2>
          <p className="subtle">
            {bi(
              locale,
              'Generate reviewable docs, a manifest patch and optional backend artifacts. The patch command is dry-run by default.',
              '生成可评审文档、清单补丁与可选后端骨架;补丁命令默认 dry-run。',
            )}
          </p>
          <button
            type="button"
            className="crud-btn"
            onClick={() => setShowScaffoldInstructions((prev) => !prev)}
          >
            {bi(locale, 'Open Scaffold Instructions', '打开脚手架指引')}
          </button>
          {showScaffoldInstructions && (
            <div className="scaffold-instructions">
              <p><strong>{bi(locale, 'Step 1', '第一步')}:</strong> {bi(locale, 'generate a scaffold package', '生成脚手架包')}</p>
              <pre className="scaffold-code-block"><code>{scaffoldCommand}</code></pre>

              <p><strong>{bi(locale, 'Step 2', '第二步')}:</strong> {bi(locale, 'review the generated notes', '评审生成的登记说明')}</p>
              <pre className="scaffold-code-block"><code>{registerCommand}</code></pre>

              <p><strong>{bi(locale, 'Step 3', '第三步')}:</strong> {bi(locale, 'regenerate the viewer index', '重新生成看板索引')}</p>
              <ul className="inline-list">
                <li>{bi(locale, 'New docs at', '新文档落在')} <code>docs/flows/&lt;flow_dir&gt;/</code></li>
                <li>{bi(locale, 'New flow appears in', '新流程出现在')} <code>/flows</code></li>
                <li><code>python3 tools/gen_diagrams.py --config design-viewer.config.json</code> {bi(locale, 'regenerates the index', '重新生成索引')}</li>
              </ul>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
