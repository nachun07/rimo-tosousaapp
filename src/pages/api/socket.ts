import { Server as NetServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import robot from 'robotjs';
import { v4 as uuidv4 } from 'uuid';
import si from 'systeminformation';
import screenshot from 'screenshot-desktop';
import { exec } from 'child_process';

export const config = {
  api: {
    bodyParser: false,
  },
};

const validTokens = new Map<string, number>();

export const getNewToken = () => {
  const token = uuidv4().substring(0, 8);
  const expiresAt = Date.now() + 60 * 60 * 1000; // 有効期限を1時間に延長（デバッグ・使い勝手のため）
  validTokens.set(token, expiresAt);
  return token;
};

export const isValidToken = (token: string): boolean => {
  if (!token) return false;
  if (token === 'pc-internal') return true;
  const expiresAt = validTokens.get(token);
  if (!expiresAt) return false;
  return expiresAt >= Date.now();
};

const ioHandler = (req: any, res: any) => {
  if (!res.socket.server.io) {
    const io = new SocketIOServer(res.socket.server as NetServer, {
      path: '/api/socket',
      addTrailingSlash: false,
      cors: { origin: '*' },
    });

    res.socket.server.io = io;

    io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      const addr = socket.handshake.address;

      console.log(`[Socket] Auth attempt: ${token?.substring(0, 3)}... from ${addr}`);

      // 無条件で許可するケース
      if (
        token === 'pc-internal' ||
        addr === '::1' ||
        addr === '127.0.0.1' ||
        addr.includes('127.0.0.1') ||
        addr.includes('::ffff:127.0.0.1') ||
        addr.includes('localhost')
      ) {
        return next();
      }

      if (isValidToken(token)) return next();

      console.error(`[Socket] Auth failed. Token: ${token}, IP: ${addr}`);
      return next(new Error('APP_AUTH_RETRY_V1'));
    });

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // 現在の接続リストを共有
      const syncDevices = () => {
        const devices: any[] = [];
        io.sockets.sockets.forEach((s: any) => {
          if (s.role) devices.push({ id: s.id, role: s.role });
        });
        io.emit('devices-list', devices);
      };

      // 役割の通知
      socket.on('set-role', (role: 'pc' | 'mobile') => {
        (socket as any).role = role;
        console.log(`Socket ${socket.id} is now ${role}`);
        syncDevices();
      });

      // マウス/キーボード操作 (Mobile -> PC)
      socket.on('mouse-move', (data: any) => robot.moveMouse(robot.getMousePos().x + (data.dx * (data.sensitivity || 1)), robot.getMousePos().y + (data.dy * (data.sensitivity || 1))));
      socket.on('mouse-drag', (data: any) => robot.dragMouse(robot.getMousePos().x + (data.dx * (data.sensitivity || 1)), robot.getMousePos().y + (data.dy * (data.sensitivity || 1))));
      socket.on('mouse-click', (button: any, double: boolean) => robot.mouseClick(button || 'left', double));
      socket.on('mouse-toggle', (data: any) => robot.mouseToggle(data.down ? 'down' : 'up', data.button));
      socket.on('mouse-scroll', (data: any) => robot.scrollMouse(0, -data.dy));
      socket.on('key-tap', (key: string, modifiers: string[] = []) => { try { robot.keyTap(key, modifiers); } catch (e) { } });
      socket.on('type-string', (text: string) => robot.typeString(text));
      socket.on('custom-macro', (data: any) => {
        try {
          if (Array.isArray(data.keys)) {
            data.keys.forEach((k: string) => robot.keyTap(k, data.modifiers || []));
          } else {
            robot.keyTap(data.keys, data.modifiers || []);
          }
        } catch (e) { }
      });

      // 画面ミラーリング (Live View) - 高速化版
      let mirroringInterval: NodeJS.Timeout | null = null;
      socket.on('start-mirroring', async (displayId: number = 0) => {
        if (mirroringInterval) clearInterval(mirroringInterval);
        mirroringInterval = setInterval(async () => {
          try {
            const img = await screenshot({ format: 'jpg', screen: displayId });
            socket.emit('screenshot-data', `data:image/jpeg;base64,${img.toString('base64')}`);
          } catch (e) { }
        }, 80); // 80ms間隔 (約12fps) - 低遅延化
      });

      socket.on('stop-mirroring', () => {
        if (mirroringInterval) {
          clearInterval(mirroringInterval);
          mirroringInterval = null;
        }
      });

      // スマホ画面のミラーリング受信・PCへ転送
      socket.on('mobile-screen-data', (data: string) => {
        socket.broadcast.emit('mobile-screen-data', { id: socket.id, data });
      });

      // PCからのスマホ操作入力の転送
      socket.on('mobile-input', (data: any) => {
        socket.broadcast.emit('mobile-input-command', data);
      });

      // ディスプレイ情報取得
      socket.on('get-displays', async () => {
        try {
          const displays = await screenshot.listDisplays();
          socket.emit('displays-list', displays);
        } catch (e) {
          socket.emit('displays-list', [{ id: 0, name: 'Main Display' }]);
        }
      });

      // システムコントロール
      socket.on('system-control', (action: string) => {
        switch (action) {
          case 'sleep': exec('pmset sleepnow'); break;
          case 'lock': exec('open -a ScreenSaverEngine'); break;
          case 'volume-up': exec('osascript -e "set volume output volume (output volume of (get volume settings) + 6)"'); break;
          case 'volume-down': exec('osascript -e "set volume output volume (output volume of (get volume settings) - 6)"'); break;
          case 'mute': exec('osascript -e "set volume with output muted"'); break;
          case 'brightness-up': exec('osascript -e "tell application \"System Events\" to repeat 2 times" -e "key code 144" -e "end repeat"'); break;
          case 'brightness-down': exec('osascript -e "tell application \"System Events\" to repeat 2 times" -e "key code 145" -e "end repeat"'); break;
        }
      });

      // PC側のスクリーンショット
      socket.on('get-screenshot', async (displayId: number = 0) => {
        try {
          const img = await screenshot({ format: 'jpg', screen: displayId });
          socket.emit('screenshot-data', `data:image/jpeg;base64,${img.toString('base64')}`);
        } catch (e) { }
      });

      // 双方向情報のやり取り
      socket.on('mobile-to-pc', (data: any) => {
        socket.broadcast.emit('message-to-pc', data);
      });
      socket.on('pc-to-mobile', (data: any) => {
        socket.broadcast.emit('message-to-mobile', data);
      });

      // システム情報
      const statsInterval = setInterval(async () => {
        try {
          const [cpu, mem, battery] = await Promise.all([si.currentLoad(), si.mem(), si.battery()]);
          socket.emit('system-stats', {
            cpu: Math.round(cpu.currentLoad),
            mem: Math.round((mem.active / mem.total) * 100),
            battery: battery.hasBattery ? battery.percent : null,
            isCharging: battery.isCharging
          });
        } catch (e) { }
      }, 3000);

      socket.on('open-path', (path: string) => exec(`open "${path}"`));
      socket.on('sync-clipboard', (text: string) => socket.broadcast.emit('clipboard-updated', text));
      socket.on('media-control', (action: string) => { try { robot.keyTap(action); } catch (e) { } });

      socket.on('disconnect', () => {
        if (mirroringInterval) clearInterval(mirroringInterval);
        clearInterval(statsInterval);
        socket.broadcast.emit('device-left', { id: socket.id });
      });
    });
  }
  res.end();
};

export default ioHandler;
