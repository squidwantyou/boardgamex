import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../lib/api';
import { useDialog } from './useDialog';

const CATEGORIES = [
  { id: 'bug', label: '有问题' },
  { id: 'confusing', label: '看不懂' },
  { id: 'idea', label: '建议' },
  { id: 'other', label: '其他' },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

export interface FeedbackDialogProps {
  matchId?: string | null;
  gameId?: string;
  onClose: () => void;
}

/** 玩家反馈入口：把真实对局反馈写进服务端，夜间由维护者导出给开发方分析。 */
export function FeedbackDialog({ matchId, gameId = 'seasons', onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<Category>('bug');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const ref = useDialog(onClose);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .feedbackCount(gameId)
      .then((result) => alive && setCount(result.count))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gameId]);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  async function submit() {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.feedback({
        gameId,
        category,
        message: text,
        contact: contact.trim() || undefined,
        matchId: matchId ?? undefined,
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="ss-feedback-backdrop" onPointerDown={onClose}>
      <div
        ref={ref}
        className="ss-feedback"
        role="dialog"
        aria-modal="true"
        aria-label="意见反馈"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {sent ? (
          <div className="ss-feedback-done">
            <h3>收到，谢谢！</h3>
            <p>反馈会进入开发者的复盘清单，用来优先修真实对局里遇到的问题。</p>
            <button type="button" className="ss-button ss-button-primary" onClick={onClose}>
              继续游戏
            </button>
          </div>
        ) : (
          <>
            <header className="ss-feedback-head">
              <h3>意见反馈</h3>
              <p>
                遇到规则错误、界面看不懂、或者有改进想法，都可以写在这里。
                {count !== null && count > 0 ? ` 已有 ${count} 条反馈。` : ''}
              </p>
            </header>
            <div className="ss-feedback-cats" role="group" aria-label="反馈类型">
              {CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`ss-chip${category === item.id ? ' ss-chip-on' : ''}`}
                  aria-pressed={category === item.id}
                  onClick={() => setCategory(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <textarea
              ref={areaRef}
              className="ss-feedback-text"
              value={message}
              maxLength={2000}
              rows={6}
              placeholder="发生了什么？当时在哪个阶段、哪张卡、你期望的结果是什么？"
              onChange={(event) => setMessage(event.target.value)}
            />
            <input
              className="ss-feedback-contact"
              value={contact}
              maxLength={120}
              placeholder="联系方式（可选，方便追问）"
              onChange={(event) => setContact(event.target.value)}
            />
            {error && <p className="ss-feedback-error">{error}</p>}
            <footer className="ss-feedback-actions">
              <span className="ss-muted">{message.length}/2000</span>
              <button type="button" className="ss-button" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="ss-button ss-button-primary"
                disabled={sending || message.trim().length === 0}
                onClick={submit}
              >
                {sending ? '发送中…' : '提交反馈'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
