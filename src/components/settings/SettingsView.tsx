import { useEffect, useState } from "react";
import { Check, KeyRound, PlugZap, Save, Terminal, X } from "lucide-react";
import { getAiSettings, setAiSettings, testAiConnection } from "../../lib/api";

/**
 * AI 设置：全屏弹层。
 * 选择 AI 提供方（本机 Claude Code CLI / OpenAI 兼容网关 API key），
 * 配置 base_url / api_key / model，可测试连接后保存（存本机 settings 表）。
 */
export default function SettingsView({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<"cli" | "openai">("cli");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyTail, setKeyTail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 挂载回显已保存配置
  useEffect(() => {
    getAiSettings()
      .then((v) => {
        setProvider(v.provider === "openai" ? "openai" : "cli");
        setBaseUrl(v.base_url);
        setModel(v.model);
        setHasKey(v.has_api_key);
        setKeyTail(v.api_key_tail);
      })
      .catch((e) => setMsg({ kind: "err", text: String(e) }));
  }, []);

  const draft = {
    provider,
    base_url: baseUrl.trim(),
    model: model.trim(),
    api_key: apiKey.trim() || null,
  };

  const test = () => {
    setBusy(true);
    setMsg(null);
    testAiConnection(draft)
      .then((r) => setMsg({ kind: "ok", text: r }))
      .catch((e) => setMsg({ kind: "err", text: String(e) }))
      .finally(() => setBusy(false));
  };

  const save = () => {
    if (provider === "openai") {
      if (!baseUrl.trim()) {
        setMsg({ kind: "err", text: "请填写网关地址（base_url）" });
        return;
      }
      if (!model.trim()) {
        setMsg({ kind: "err", text: "请填写模型名称" });
        return;
      }
    }
    setBusy(true);
    setMsg(null);
    setAiSettings(draft)
      .then(() => {
        if (apiKey.trim()) setHasKey(true);
        setApiKey(""); // 清空输入框，避免界面残留明文
        setMsg({ kind: "ok", text: "已保存，学习模块将使用当前配置" });
      })
      .catch((e) => setMsg({ kind: "err", text: String(e) }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="toast-mask settings-view">
      <div className="settings-card">
        <button className="help-close" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        <h2>AI 设置</h2>
        <p className="settings-sub">学习助手的 AI 提供方（生成计划 / 问答 / 出题）</p>

        {/* 提供方选择 */}
        <div className="settings-providers">
          <button
            className={`settings-provider ${provider === "cli" ? "on" : ""}`}
            onClick={() => setProvider("cli")}
          >
            <Terminal size={16} />
            <div>
              <div className="settings-provider-name">本机 Claude Code（CLI）</div>
              <div className="settings-provider-desc">复用本机已登录的 claude 命令</div>
            </div>
            {provider === "cli" && <Check size={15} className="settings-provider-check" />}
          </button>
          <button
            className={`settings-provider ${provider === "openai" ? "on" : ""}`}
            onClick={() => setProvider("openai")}
          >
            <KeyRound size={16} />
            <div>
              <div className="settings-provider-name">API Key（OpenAI 兼容）</div>
              <div className="settings-provider-desc">DeepSeek / 硅基流动等网关直连</div>
            </div>
            {provider === "openai" && <Check size={15} className="settings-provider-check" />}
          </button>
        </div>

        {/* OpenAI 兼容网关字段 */}
        {provider === "openai" && (
          <div className="settings-fields">
            <label className="settings-label">网关地址（base_url）</label>
            <input
              className="study-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="如 https://api.deepseek.com/v1"
            />
            <label className="settings-label">API Key</label>
            <input
              className="study-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasKey
                  ? `已保存（末 4 位 ${keyTail}），留空则不修改`
                  : "请输入 API key"
              }
            />
            <label className="settings-label">模型名称</label>
            <input
              className="study-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="如 deepseek-chat"
            />
          </div>
        )}

        {msg && <p className={`settings-msg ${msg.kind}`}>{msg.text}</p>}

        <div className="settings-actions">
          <button className="study-ghost-btn" onClick={test} disabled={busy}>
            <PlugZap size={15} /> 测试连接
          </button>
          <button className="study-primary-btn" onClick={save} disabled={busy}>
            <Save size={15} /> 保存
          </button>
        </div>

        <p className="settings-hint">
          密钥仅保存在本机数据库中（明文），不会上传；AI 请求会直接发往你填写的网关地址。
        </p>
      </div>
    </div>
  );
}
