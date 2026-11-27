import { io, type Socket } from 'socket.io-client';

/**
 * 线上通过 Apache 反代到 /bgx/socket.io，强制 websocket，避免轮询链路。
 * 与后端必须使用同一个 path。
 */
export function connectSocket(): Socket {
  return io({
    path: `${import.meta.env.BASE_URL}socket.io`,
    transports: ['websocket'],
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
    timeout: 8000,
  });
}
