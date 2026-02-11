import { Server as NetServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import si from 'systeminformation';
import { exec } from 'child_process';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, onChildAdded, remove, set } from "firebase/database";

// Vercel等のサーバー環境でネイティブモジュールが使えない場合の対策
let robot: any;
try {
  robot = require('robotjs');
} catch (e) {
  console.warn('[Socket] robotjs is not available in this environment.');
  // Dummy robot implementation
  robot = {
    moveMouse: () => { },
    dragMouse: () => { },
    mouseClick: () => { },
    mouseToggle: () => { },
    scrollMouse: () => { },
    keyTap: () => { },
    typeString: () => { },
    getMousePos: () => ({ x: 0, y: 0 })
  };
}

let screenshot: any;
try {
  screenshot = require('screenshot-desktop');
} catch (e) {
  console.warn('[Socket] screenshot-desktop is not available in this environment.');
  // Dummy screenshot implementation
  screenshot = async () => Buffer.alloc(0);
  screenshot.listDisplays = async () => [{ id: 0, name: 'Main (Mock)' }];
}

export const config = {
  api: {
    bodyParser: false,
  },
};

const firebaseConfig = {
  apiKey: "AIzaSyCtEgtzYj-1SXeWqwxRY_9joMAPSbJWk8Q",
  authDomain: "rimo-to-app.firebaseapp.com",
  databaseURL: "https://rimo-to-app-default-rtdb.firebaseio.com",
  projectId: "rimo-to-app",
  storageBucket: "rimo-to-app.firebasestorage.app",
  messagingSenderId: "531834533075",
  appId: "1:531834533075:web:960e089a823668ad80d026"
};

const fbApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

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
      socket.on('set-role', (role: 'pc' | 'mobile', uid?: string) => {
        (socket as any).role = role;
        (socket as any).uid = uid;
        console.log(`Socket ${socket.id} is now ${role}${uid ? ' for user ' + uid : ''}`);
        syncDevices();

        // PCの場合、Firebaseからのコマンド待ち受けを開始
        if (role === 'pc' && uid) {
          console.log(`[Firebase] Starting relay listener for user: ${uid}`);
          const cmdRef = ref(db, `users/${uid}/commands`);
          const unsub = onChildAdded(cmdRef, (snapshot) => {
            const cmd = snapshot.val();
            if (!cmd) return;

            console.log(`[Firebase] Relay command received: ${cmd.type}`);
            handleCommand(cmd);

            // 実行したら削除
            remove(snapshot.ref);
          });
          socket.on('disconnect', () => unsub());
        }
      });

      const handleCommand = async (data: any) => {
        try {
          switch (data.type) {
            case 'mouse-move': robot.moveMouse(robot.getMousePos().x + (data.dx * (data.sensitivity || 1)), robot.getMousePos().y + (data.dy * (data.sensitivity || 1))); break;
            case 'mouse-drag': robot.dragMouse(robot.getMousePos().x + (data.dx * (data.sensitivity || 1)), robot.getMousePos().y + (data.dy * (data.sensitivity || 1))); break;
            case 'mouse-click': robot.mouseClick(data.button || 'left', data.double || false); break;
            case 'mouse-toggle': robot.mouseToggle(data.down ? 'down' : 'up', data.button); break;
            case 'mouse-scroll': robot.scrollMouse(0, -data.dy); break;
            case 'key-tap': robot.keyTap(data.key, data.modifiers || []); break;
            case 'type-string': robot.typeString(data.text); break;
            case 'custom-macro':
              if (Array.isArray(data.keys)) {
                data.keys.forEach((k: string) => robot.keyTap(k, data.modifiers || []));
              } else {
                robot.keyTap(data.keys, data.modifiers || []);
              }
              break;
            case 'system-control':
              switch (data.action) {
                case 'sleep': exec('pmset sleepnow'); break;
                case 'lock': exec('open -a ScreenSaverEngine'); break;
                case 'volume-up': exec('osascript -e "set volume output volume (output volume of (get volume settings) + 6)"'); break;
                case 'volume-down': exec('osascript -e "set volume output volume (output volume of (get volume settings) - 6)"'); break;
                case 'mute': exec('osascript -e "set volume with output muted"'); break;
                case 'brightness-up': exec('osascript -e "tell application \"System Events\" to repeat 2 times" -e "key code 144" -e "end repeat"'); break;
                case 'brightness-down': exec('osascript -e "tell application \"System Events\" to repeat 2 times" -e "key code 145" -e "end repeat"'); break;
                case 'display-settings': exec('open "x-apple.systempreferences:com.apple.Displays-Settings.extension"'); break;
              }
              break;
            case 'open-path': exec(`open "${data.path}"`); break;
            case 'media-control': robot.keyTap(data.action); break;
            case 'get-screenshot':
              try {
                const img = await screenshot({ format: 'jpg', screen: data.displayId || 0 });
                const base64 = `data:image/jpeg;base64,${img.toString('base64')}`;
                const uid = (socket as any).uid;
                if (uid) {
                  set(ref(db, `users/${uid}/screenshot`), base64);
                }
                socket.emit('screenshot-data', base64);
              } catch (e) { }
              break;
          }
        } catch (e) {
          console.error('[Relay] Command execution error:', e);
        }
      };

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
          case 'display-settings': exec('open "x-apple.systempreferences:com.apple.Displays-Settings.extension"'); break;
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
        syncDevices();
      });
    });
  }
  res.end();
};

export default ioHandler;
