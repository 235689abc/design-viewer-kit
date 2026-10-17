import { useEffect, useState } from 'react';
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
    setStatusText(normalized ? 'Saved / 已保存' : 'Cleared / 已清空');
  };

  const onClear = () => {
    setRuntimeBaseUrl('');
    setSavedValue(null);
    setRuntimeUrlInput('');
    setStatusText('Cleared / 已清空');
  };

  return (
    <section className="page">
      <h1>Settings / 设置</h1>
      <p className="subtle">
        Runtime integration is optional. Viewer remains design-only without a runtime URL.
      </p>

      <div className="detail-grid">
        <article className="card">
          <h2>Runtime Base URL / 运行态地址</h2>
          <p className="subtle">Example: <code>http://localhost:3000</code></p>
          <div className="settings-form">
            <label htmlFor="runtime-base-url">Runtime Base URL</label>
            <input
              id="runtime-base-url"
              type="text"
              placeholder="http://localhost:3000"
              value={runtimeUrlInput}
              onChange={(event) => setRuntimeUrlInput(event.target.value)}
            />
            <div className="settings-form-actions">
              <button type="button" className="crud-btn" onClick={onSave}>
                Save / 保存
              </button>
              <button type="button" className="crud-btn settings-btn-secondary" onClick={onClear}>
                Clear / 清空
              </button>
            </div>
          </div>
          <p>Current / 当前: <code>{savedValue ?? '-'}</code></p>
          {statusText && <p className="subtle">{statusText}</p>}
        </article>

        <article className="card">
          <h2>Flow Scaffolder / 流程脚手架</h2>
          <p className="subtle">
            Generate reviewable docs, a manifest patch and optional backend artifacts. The patch
            command is dry-run by default.
          </p>
          <button
            type="button"
            className="crud-btn"
            onClick={() => setShowScaffoldInstructions((prev) => !prev)}
          >
            Open Scaffold Instructions / 打开脚手架指引
          </button>
          {showScaffoldInstructions && (
            <div className="scaffold-instructions">
              <p><strong>Step 1 / 第一步:</strong> generate a scaffold package</p>
              <pre className="scaffold-code-block"><code>{scaffoldCommand}</code></pre>

              <p><strong>Step 2 / 第二步:</strong> review the generated notes</p>
              <pre className="scaffold-code-block"><code>{registerCommand}</code></pre>

              <p><strong>Step 3 / 第三步:</strong> regenerate the viewer index</p>
              <ul className="inline-list">
                <li>New docs at <code>docs/flows/&lt;flow_dir&gt;/</code></li>
                <li>New flow appears in <code>/flows</code></li>
                <li><code>python3 tools/gen_diagrams.py --config design-viewer.config.json</code> regenerates the index</li>
              </ul>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
