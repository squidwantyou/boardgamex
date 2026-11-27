import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import type {
  ChatMessage,
  GameOptionValues,
  MatchSummary,
  MatchView,
  ServerMessage,
} from '@bgx/protocol';
import { connectSocket } from '../lib/socket';
import { api, ApiError, cachedMe, errorMessage, loadMe, uid } from '../lib/api';
import { useMe } from '../hooks/useMe';
import { usePageMeta, DEFAULT_PAGE_DESCRIPTION } from '../hooks/usePageMeta';
import { useToast } from '../hooks/useToast';
import { getGameUi } from '../games';
import type { StartedMatchView } from '../games/types';
import { Chat } from '../components/Chat';
import { GameOptions } from '../components/GameOptions';
import { Toast } from '../components/Toast';
import { hueOf, timeAgo } from '../lib/format';

type ConnState = 'connecting' | 'online' | 'offline' | 'error';

export function MatchPage() {
  const { matchId = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const { toast, show } = useToast();

  const [view, setView] = useState<MatchView | null>(null);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [connMessage, setConnMessage] = useState('');
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<'resign' | 'rematch' | 'join' | 'start' | 'abort' | null>(null);
  const [optionBusy, setOptionBusy] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let alive = true;
    setNotFound(false);
    setSummary(null);
    const sessionReady = loadMe();
    sessionReady
      .then(() => api.match(matchId))
      .then((res) => {
        if (alive) setSummary(res.match);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else show(errorMessage(err), 'error');
      });
    sessionReady
      .then(() => api.chat(matchId))
      .then((res) => {
        if (alive) setMessages(res.messages);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [matchId, show]);

  useEffect(() => {
    setView(null);
    setMessages([]);
    setConn('connecting');
    setConnMessage('');

    const sessionReady = loadMe();
    let socket: Socket | null = null;
    const connectWhenReady = () => {
      if (!sessionReady || socket) return;
      socket = connectSocket();
      socketRef.current = socket;
      attachSocket(socket);
    };
    const attachSocket = (activeSocket: Socket) => {
      activeSocket.on('connect', () => {
        setConn('connecting');
        setConnMessage('正在进入房间…');
        activeSocket.emit('join', { t: 'join', matchId });
      });
      activeSocket.on('disconnect', () => {
        setConn('offline');
        setConnMessage(activeSocket.active ? '连接中断，正在恢复…' : '连接已关闭');
      });
      let recoveringSession = false;
      activeSocket.on('connect_error', (error) => {
        const unauthorized = error.message === 'unauthorized' || error.message === 'unauthorized_local_session_expired';
        void api.debugSession().then((info) => {
          console.warn('BGX session diagnostic', {
            socketError: error.message,
            httpUser: info.user?.id,
            cookieCount: info.cookieCount,
            cookieFingerprints: info.cookieFingerprints,
            headerFingerprint: info.headerFingerprint,
          });
          if (info.cookieCount > 1) {
            document.cookie = 'bgx_sid=; Path=/bgx; Max-Age=0';
            document.cookie = 'bgx_sid=; Path=/; Max-Age=0';
            void loadMe({ refresh: true }).then(() => activeSocket.connect());
          }
        }).catch(() => undefined);
        if (unauthorized && !recoveringSession) {
          recoveringSession = true;
          setConn('connecting');
          setConnMessage('正在恢复本地会话…');
          void loadMe({ refresh: true })
            .then(() => activeSocket.connect())
            .catch(() => {
              setConn('error');
              setConnMessage('本地会话恢复失败');
            });
          return;
        }
        setConn('error');
        setConnMessage(
          unauthorized
            ? '本地会话仍无效，请重新启动本地服务'
            : '无法连接本地服务',
        );
      });

      activeSocket.on('snapshot', (msg: ServerMessage) => {
        if (msg.t === 'snapshot') {
          const expectedUserId = cachedMe()?.id;
          if (expectedUserId && msg.view.you.userId !== expectedUserId) {
            activeSocket.disconnect();
            setConn('connecting');
            setConnMessage('会话不一致，正在重新进入…');
            window.location.reload();
            return;
          }
          setView(msg.view);
          setNotFound(false);
          setConn('online');
          setConnMessage('');
        }
      });

      activeSocket.on('update', (msg: ServerMessage) => {
        if (msg.t !== 'update') return;
        setView((prev) => (!prev || msg.view.seq >= prev.seq ? msg.view : prev));
        const gameUi = getGameUi(msg.view.gameId);
        for (const event of msg.events) {
          const notice = gameUi?.eventMessage?.(event);
          if (notice) show(notice.text, notice.tone ?? 'info');
        }
        api
          .match(matchId)
          .then((res) => setSummary(res.match))
          .catch(() => undefined);
      });

      activeSocket.on('chat', (msg: ServerMessage) => {
        if (msg.t !== 'chat') return;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.message.id) ? prev : [...prev, msg.message],
        );
      });

      activeSocket.on('rematch', (msg: ServerMessage) => {
        if (msg.t !== 'rematch') return;
        show('新对局已开，正在进入…', 'success');
        navigate(`/m/${msg.matchId}`);
      });

      activeSocket.on('error', (msg: ServerMessage) => {
        if (msg.t !== 'error') return;
        if (msg.code === 'match_not_found') {
          setNotFound(true);
          activeSocket.disconnect();
          setConn('error');
          setConnMessage('房间不存在');
          return;
        }
        show(msg.message, 'error');
      });
      activeSocket.connect();
    };

    void sessionReady.then(connectWhenReady);

    return () => {
      socket?.emit('leave', { t: 'leave', matchId });
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [matchId, navigate, show, joinAttempt]);

  const sendChat = useCallback(
    (text: string): boolean => {
      const socket = socketRef.current;
      if (!socket || conn !== 'online') return false;
      socket.emit('chat', { t: 'chat', matchId, text });
      return true;
    },
    [conn, matchId],
  );

  /** 框架只透传动作；形状与合法性由当前游戏插件/引擎负责。 */
  function sendGameAction(action: unknown) {
    const socket = socketRef.current;
    if (!socket || !view || conn !== 'online') return;
    socket.emit('action', {
      t: 'action',
      matchId,
      actionId: uid(),
      action,
    });
  }

  function resign() {
    const socket = socketRef.current;
    if (!socket || !view || view.you.seat === null || !view.canResign) return;
    if (!window.confirm('确定要认输吗？')) return;
    socket.emit('action', {
      t: 'action',
      matchId,
      actionId: uid(),
      action: { type: 'resign' },
    });
  }

  async function joinSeat() {
    if (busy) return;
    setBusy('join');
    try {
      await api.joinMatch(matchId);
      socketRef.current?.emit('join', { t: 'join', matchId });
      show('已加入对局', 'success');
    } catch (err) {
      show(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function startGame() {
    if (busy) return;
    setBusy('start');
    try {
      await api.startMatch(matchId);
      socketRef.current?.emit('join', { t: 'join', matchId });
      show('对局开始', 'success');
    } catch (err) {
      show(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function abortGame() {
    if (busy || !window.confirm('确定要中止这局吗？中止后不能继续。')) return;
    setBusy('abort');
    try {
      await api.abortMatch(matchId);
      show('对局已中止', 'success');
    } catch (err) {
      show(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function rematch() {
    if (busy) return;
    setBusy('rematch');
    try {
      const res = await api.rematch(matchId);
      navigate(`/m/${res.matchId}`);
    } catch (err) {
      show(errorMessage(err), 'error');
      setBusy(null);
    }
  }

  async function changeOptions(patch: GameOptionValues) {
    if (optionBusy || !view || view.hostId !== me?.id) return;
    setOptionBusy(true);
    try {
      await api.updateOptions(matchId, patch);
    } catch (err) {
      show(errorMessage(err), 'error');
    } finally {
      setOptionBusy(false);
    }
  }

  async function copyInvite() {
    const link = `${window.location.origin}${import.meta.env.BASE_URL}m/${matchId}`;
    try {
      await navigator.clipboard.writeText(link);
      show('邀请链接已复制', 'success');
    } catch {
      window.prompt('复制这个链接发给朋友：', link);
    }
  }

  const metaGameId = view?.gameId ?? summary?.gameId ?? null;
  const metaGameName = view?.gameName ?? summary?.gameName;
  const gameUi = getGameUi(metaGameId);
  usePageMeta(
    notFound
      ? '房间不存在 · BGX'
      : metaGameId
        ? `${metaGameName ?? '对局'} · 房间 #${matchId} · BGX`
        : `房间 #${matchId} · BGX`,
    notFound
      ? '这个房间不存在或已经结束。'
      : (gameUi?.meta.description ?? DEFAULT_PAGE_DESCRIPTION),
  );

  const isPlayer = !!view && view.you.seat !== null;
  const isHost = !!view && me?.id === view.hostId;
  const waiting = view?.status === 'waiting';
  const finished = view?.status === 'finished';
  const maxPlayers = view?.maxPlayers ?? summary?.maxPlayers ?? 2;
  const minPlayers = view?.minPlayers ?? summary?.minPlayers ?? 2;
  const playerCount = view?.players.length ?? summary?.playerCount ?? 0;
  const full = playerCount >= maxPlayers;
  const startedView =
    view && view.game ? (view as StartedMatchView<unknown>) : null;
  const fullBleed = Boolean(!notFound && startedView && gameUi?.meta.fullBleed);

  useEffect(() => {
    if (!fullBleed) return;
    document.body.classList.add('bgx-fullbleed');
    return () => document.body.classList.remove('bgx-fullbleed');
  }, [fullBleed]);

  if (notFound) {
    return (
      <div className="page">
        <div className="notice-card">
          <p className="eyebrow">404</p>
          <h1>房间不存在</h1>
          <p className="muted">可能是房间号不对，或者这局已经被清理了。</p>
          <Link to="/" className="btn btn-primary">
            回到大厅
          </Link>
        </div>
        <Toast toast={toast} />
      </div>
    );
  }

  function headline(): string {
    if (!view) return '正在进入房间…';
    if (waiting) {
      if (playerCount < minPlayers) return '等待玩家加入';
      return isHost ? '可以开始了' : '等待房主开始';
    }
    if (view.aborted) return '房主中止了对局';
    if (!startedView) return '对局进行中';
    return gameUi?.headline(startedView, view.you.seat) ?? '对局进行中';
  }

  function statusLine(): string {
    if (!view) return '正在同步房间状态';
    if (waiting) {
      const need = minPlayers - playerCount;
      return need > 0
        ? `还差 ${need} 人 · 房主开始后进入对局`
        : '人齐了 · 等待房主点击「开始对局」';
    }
    if (view.aborted) return '本局由房主中止，不计胜负';
    if (!startedView) return '';
    return gameUi?.statusLine(startedView) ?? '';
  }

  const optionDefs = gameUi?.meta.options ?? [];
  const selectedDisabledChoices = optionDefs.flatMap((def) => {
    const value = view?.options[def.id] ?? def.default;
    const selected = Array.isArray(value) ? value : value ? [value] : [];
    return def.choices.filter(
      (choice) => choice.disabled && selected.includes(choice.value),
    );
  });
  const hasUnsupportedOptions = selectedDisabledChoices.length > 0;

  function optionLabels(value: string | string[] | undefined, def: (typeof optionDefs)[number]) {
    const selected = Array.isArray(value) ? value : value ? [value] : [];
    return def.choices
      .filter((choice) => selected.includes(choice.value))
      .map((choice) => choice.label)
      .join('、');
  }
  const optionSummary = view
    ? optionDefs
        .map((def) => {
          const label = optionLabels(view.options[def.id], def);
          return `${def.label}：${label || (Array.isArray(def.default) ? def.default.join('、') : def.default)}`;
        })
        .join(' · ')
    : '';

  return (
    <div className="page match-page">
      <div className={`match-topbar${fullBleed ? ' match-topbar-fullbleed' : ''}`}>
        <Link to="/" className="back-link">
          ← 大厅
        </Link>
        <div className="topbar-mid">
          <span className="room-code">房间 #{matchId}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyInvite()}>
            复制邀请链接
          </button>
        </div>
        <span className={`conn conn-${conn}`}>
          <span className="conn-dot" aria-hidden />
          {conn === 'online'
            ? '已连接'
            : conn === 'offline'
              ? '重连中…'
              : conn === 'error'
                ? '连接失败'
                : '连接中…'}
        </span>
        {conn === 'error' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setJoinAttempt((attempt) => attempt + 1)}
          >
            重试
          </button>
        )}
        {connMessage && <span className="conn-detail">{connMessage}</span>}
      </div>

      <div className={`match-layout${fullBleed ? ' match-layout-full' : ''}`}>
        <main className="match-main">
          <section className={`panel game-panel${fullBleed ? ' game-panel-full' : ''}`}>
            {!fullBleed && (
              <div className="game-head">
                <div>
                  <p className="eyebrow">{view?.gameName ?? summary?.gameName ?? '对局'}</p>
                  <h1 className="game-headline">{headline()}</h1>
                  <p className="muted small">{statusLine()}</p>
                  {!waiting && optionSummary && (
                    <p className="option-summary muted small">{optionSummary}</p>
                  )}
                </div>
              </div>
            )}

            {waiting && (
              <div className="invite-box">
                <div>
                  <p className="invite-label">房间号</p>
                  <p className="invite-code">{matchId}</p>
                </div>
                <div className="invite-actions">
                  {waiting && view && isHost && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void startGame()}
                      disabled={
                        busy === 'start' ||
                        playerCount < minPlayers ||
                        conn !== 'online' ||
                        hasUnsupportedOptions
                      }
                    >
                      {busy === 'start'
                        ? '开始中…'
                        : hasUnsupportedOptions
                          ? '请先调整扩展设置'
                        : playerCount < minPlayers
                          ? `还差 ${minPlayers - playerCount} 人`
                          : '开始对局'}
                    </button>
                  )}
                  {view && !isPlayer && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void joinSeat()}
                      disabled={busy === 'join' || !waiting || full}
                      title={full ? '房间已满，只能观战' : undefined}
                    >
                      {busy === 'join' ? '加入中…' : full ? '房间已满' : '加入对局'}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={() => void copyInvite()}>
                    复制邀请链接
                  </button>
                </div>
              </div>
            )}

            {waiting && view && optionDefs.length > 0 && (
              <div className="options-box">
                <div className="options-head">
                  <span className="options-title">开局设置</span>
                  <span className="muted small">
                    {isHost ? '开始前可修改，开局后锁定' : '由房主设置'}
                  </span>
                </div>
                <GameOptions
                  definitions={optionDefs}
                  values={view.options}
                  disabled={!isHost || optionBusy || conn !== 'online'}
                  onChange={(patch) => void changeOptions(patch)}
                />
                {hasUnsupportedOptions && (
                  <p className="option-warning" role="status">
                    扩展牌面和数据已加入，但部分扩展牌效果仍在开发。
                    请取消勾选这些扩展包，只保留“基础 50 张”后开始对局。
                  </p>
                )}
              </div>
            )}

            {startedView && gameUi ? (
              <gameUi.Panel
                view={startedView}
                mySeat={view?.you.seat ?? null}
                disabled={conn !== 'online'}
                onAction={sendGameAction}
              />
            ) : waiting ? (
              <div className="board-frame board-loading">
                <span className="muted">房主开始后，棋盘会出现在这里</span>
              </div>
            ) : view ? (
              <div className="board-frame board-loading">
                <span className="muted">这个房间的游戏暂时无法显示</span>
              </div>
            ) : (
              <div className="board-frame board-loading">
                <span className="muted">正在同步棋盘…</span>
              </div>
            )}

            {startedView && view?.you.spectator && (
              <p className="spectator-note">
                {gameUi?.spectatorNote?.(startedView) ?? '你正在观战，棋盘会实时同步。'}
              </p>
            )}

            <div className="game-actions">
              {view && isPlayer && view.status === 'active' && (
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  onClick={resign}
                  disabled={!view.canResign}
                  title={view.canResign ? undefined : '当前不能认输'}
                >
                  认输
                </button>
              )}
              {view && isHost && view.status === 'active' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void abortGame()}
                  disabled={busy === 'abort'}
                >
                  {busy === 'abort' ? '中止中…' : '中止对局'}
                </button>
              )}
              {finished && isPlayer && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void rematch()}
                  disabled={busy === 'rematch'}
                >
                  {busy === 'rematch' ? '创建中…' : '再来一局'}
                </button>
              )}
              {finished && (
                <Link to="/" className="btn btn-ghost">
                  回到大厅
                </Link>
              )}
            </div>
          </section>

          {!fullBleed && (
            <Chat
              messages={messages}
              meId={me?.id ?? null}
              onSend={sendChat}
              disabled={conn !== 'online'}
            />
          )}
        </main>

        {!fullBleed && <aside className="match-side">
          <section className="panel players-panel">
            <div className="panel-head">
              <h2>玩家</h2>
              <span className="muted small">
                {playerCount}/{maxPlayers} · 至少 {minPlayers}
              </span>
            </div>
            <ul className="player-list">
              {Array.from({ length: maxPlayers }, (_, seat) => {
                const player = view?.players.find((p) => p.seat === seat) ?? null;
                const activeSeat =
                  view?.status === 'active' && view.currentSeat === seat;
                const won = finished && view?.winner === seat;
                const badge =
                  startedView && gameUi?.playerBadge
                    ? gameUi.playerBadge(startedView, seat)
                    : null;
                return (
                  <li key={seat} className={`player-row${activeSeat ? ' active-seat' : ''}`}>
                    <span className={`seat-disc ${seat === 0 ? 'black' : 'white'}`} aria-hidden />
                    {player ? (
                      <>
                        <Link
                          to={`/p/${player.userId}`}
                          className="avatar-link"
                          title={`查看 ${player.name} 的主页`}
                          aria-label={`查看 ${player.name} 的主页`}
                        >
                          <span
                            className="avatar avatar-sm"
                            style={{ background: `hsl(${hueOf(player.userId)} 52% 40%)` }}
                          >
                            {player.name.slice(0, 1)}
                          </span>
                        </Link>
                        <span className="player-name">
                          {player.name}
                          {player.isYou && <span className="you-tag">你</span>}
                        </span>
                        {won && <span className="win-tag">胜</span>}
                        {badge && <span className="turn-tag">{badge}</span>}
                      </>
                    ) : (
                      <>
                        <span className="avatar avatar-sm avatar-empty">?</span>
                        <span className="player-name muted">等待玩家加入</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="muted small panel-foot">
              房间创建于 {view ? timeAgo(view.createdAt) : '—'}
              {view?.startedAt ? ` · 开局于 ${timeAgo(view.startedAt)}` : ''}
            </p>
          </section>

          <section className="panel tips-panel">
            <div className="panel-head">
              <h2>提示</h2>
            </div>
            <ul className="rule-list compact">
              {(gameUi?.meta.rules ?? ['刷新页面不会丢局，重新进入房间即可继续。']).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        </aside>}
      </div>

      <Toast toast={toast} />
    </div>
  );
}
