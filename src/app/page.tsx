'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { auth, db, googleProvider } from '../lib/firebase';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';
import { ref, push, set } from 'firebase/database';

type Tab = 'mouse' | 'keys' | 'draw' | 'macro' | 'media' | 'monitor' | 'mirror' | 'num' | 'power' | 'sync' | 'config';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [tab, setTab] = useState<Tab>('mouse');
  const [clipboard, setClipboard] = useState('');
  const [active, setActive] = useState(false);
  const [scroll, setScroll] = useState(false);
  const [sens, setSens] = useState(2.0);
  const [scrollSens, setScrollSens] = useState(3.0);
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [authError, setAuthError] = useState('');
  const [connectionTime, setConnectionTime] = useState<Date | null>(null);
  const [ipAddress, setIpAddress] = useState('');
  const [showQRFullscreen, setShowQRFullscreen] = useState(false);

  const [stats, setStats] = useState<{ cpu: number, mem: number, battery: number | null, isCharging: boolean }>({ cpu: 0, mem: 0, battery: null, isCharging: false });
  const [ss, setSs] = useState<string | null>(null);
  const [isMirroring, setIsMirroring] = useState(false);
  const [displays, setDisplays] = useState<any[]>([]);
  const [selectedDisplay, setSelectedDisplay] = useState(0);
  const [connectedMobiles, setConnectedMobiles] = useState<any[]>([]);
  const [mobileScreenData, setMobileScreenData] = useState<string | null>(null);
  const [isSharingMobileScreen, setIsSharingMobileScreen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [appSearch, setAppSearch] = useState('');
  const [touchIndicator, setTouchIndicator] = useState<{ x: number, y: number } | null>(null);
  const [targetServerUrl, setTargetServerUrl] = useState<string>('');
  const [tick, setTick] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  const last = useRef({ x: 0, y: 0 });
  const fingers = useRef(0);
  const scrollY = useRef(0);
  const scannerRef = useRef<any>(null); // Html5Qrcode インスタンス用
  const isInitialized = useRef(false);

  const shortcuts = [
    { n: '保存', k: ['s'], m: ['command'], icon: '💾', color: '#4caf50' },
    { n: 'コピー', k: ['c'], m: ['command'], icon: '📋', color: '#2196f3' },
    { n: '貼付', k: ['v'], m: ['command'], icon: '📌', color: '#ff9800' },
    { n: '全選択', k: ['a'], m: ['command'], icon: '🔘', color: '#9c27b0' },
    { n: '戻す', k: ['z'], m: ['command'], icon: '↩️', color: '#607d8b' },
    { n: '閉じる', k: ['w'], m: ['command'], icon: '❌', color: '#f44336' },
  ];

  const launchers = [
    { n: 'Chrome', q: 'Google Chrome', icon: '🌐' },
    { n: 'Slack', q: 'Slack', icon: '💬' },
    { n: 'Code', q: 'Visual Studio Code', icon: '💻' },
    { n: 'Finder', q: 'Finder', icon: '📂' },
    { n: 'ターミナル', q: 'Terminal', icon: '⚙️' },
  ];

  const emit = useCallback((type: string, ...args: any[]) => {
    if (socket?.connected) {
      socket.emit(type, ...args);
    } else if (user) {
      // Firebase用ペイロードの構成
      let payload: any = { type };

      // 特殊なコマンドの引数マッピング
      if (type === 'mouse-click') {
        payload.button = args[0] || 'left';
        payload.double = args[1] || false;
      } else if (type === 'key-tap') {
        payload.key = args[0];
        payload.modifiers = args[1] || [];
      } else if (type === 'system-control') {
        payload.action = args[0];
      } else if (type === 'open-path') {
        payload.path = args[0];
      } else if (type === 'media-control') {
        payload.action = args[0];
      } else if (typeof args[0] === 'object') {
        payload = { ...payload, ...args[0] };
      } else if (args[0] !== undefined) {
        payload.value = args[0];
      }

      push(ref(db, `users/${user.uid}/commands`), payload);

      if (type.includes('click') || type.includes('tap')) {
        showHint('📡 リレー送信中...');
      }
    }
  }, [socket, user]);

  useEffect(() => {
    // リダイレクト後の結果を確認
    getRedirectResult(auth).catch((e) => {
      console.error("Redirect auth error:", e);
      if (e.code !== 'auth/popup-closed-by-user') {
        setAuthError("ログイン中にエラーが発生しました。設定を確認してください。");
      }
    });

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    setIsMobile(mobile);

    if (user) {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || localStorage.getItem('remote_token');
      const serverUrl = params.get('server') || localStorage.getItem('remote_server');

      if (serverUrl) {
        setTargetServerUrl(serverUrl);
        localStorage.setItem('remote_server', serverUrl);
      }

      if (token) {
        if (params.get('token')) localStorage.setItem('remote_token', params.get('token')!);
        init(token);
      } else if (!mobile && !isInitialized.current) {
        refresh();
        init('pc-internal');
        isInitialized.current = true;
      }
    }
  }, [user]);

  useEffect(() => {
    if (showScanner) {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        setAuthError("セキュリティ(HTTPS)の制限によりカメラが使えません。パスワードを入力してください。");
        setShowScanner(false);
        setShowPasswordLogin(true);
        return;
      }

      // ライブラリを動的にインポート（SSR回避）
      import('html5-qrcode').then(({ Html5Qrcode }) => {
        const html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            try {
              const url = new URL(decodedText);
              const token = url.searchParams.get('token');
              const server = url.searchParams.get('server');
              if (token) {
                localStorage.setItem('remote_token', token);
                if (server) {
                  localStorage.setItem('remote_server', server);
                  setTargetServerUrl(server);
                }
                showHint('📷 スキャン成功');
                setShowScanner(false);
                // 取得したサーバーURLを直接渡して即時接続
                init(token, server || undefined);
              }
            } catch (e) { console.error(e); }
          },
          () => { }
        ).catch(err => {
          console.error("Camera access error:", err);
          setAuthError("カメラの起動に失敗しました。");
          setShowScanner(false);
        });
      });

      return () => {
        if (scannerRef.current) {
          scannerRef.current.stop().then(() => {
            scannerRef.current.clear();
          }).catch((e: any) => console.error(e));
        }
      };
    }
  }, [showScanner]);

  useEffect(() => {
    if (connectionTime) {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [connectionTime]);

  const init = async (token: string, forcedServerUrl?: string) => {
    setIsConnecting(true);
    setAuthError('');
    const isVercel = window.location.hostname.includes('vercel.app');

    // 接続先の決定優先順位:
    // 1. スキャンや入力で強制されたURL (forcedServerUrl)
    // 2. 保存されているURL (targetServerUrl)
    // 3. PC内部接続(localhost)
    // 4. 現在のドメイン (Vercel以外の場合のみ)
    let connectUrl = forcedServerUrl || targetServerUrl;

    if (token === 'pc-internal' && isVercel) {
      connectUrl = 'http://localhost:3000';
    }

    if (!connectUrl && !isVercel) {
      connectUrl = window.location.origin;
    }

    // Vercel自身にはWebSocketサーバーがないため、スマホがここに繋ごうとしたらエラーを出すか
    // もしくは接続を試みない。
    if (isMobile && !connectUrl) {
      setAuthError('接続先(サーバーURL)が指定されていません。Vercelで開いている場合は、PC側のQRコードをスキャンしてください。');
      setIsConnecting(false);
      return;
    }

    // Vercel自身ではなく、指定されたサーバー（自宅Mac）のSocket.IOを探しに行く
    const socketOptions = {
      path: '/api/socket',
      auth: { token },
      transports: ['websocket', 'polling']
    };

    const s = connectUrl ? io(connectUrl, socketOptions) : io(socketOptions);

    s.on('connect', () => {
      setIsConnecting(false);
      setSocket(s);
      setAuthError('');
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (mobile) {
        s.emit('set-role', 'mobile', user?.uid);
        s.emit('get-displays');
        setConnectionTime(new Date());

        // スマホのステータスをPCに送信
        const sendMobileStatus = () => {
          if ('getBattery' in navigator) {
            (navigator as any).getBattery().then((b: any) => {
              s.emit('mobile-to-pc', { type: 'status', battery: Math.round(b.level * 100), charging: b.charging });
            });
          }
        };
        const interval = setInterval(sendMobileStatus, 5000);
        return () => clearInterval(interval);
      } else {
        s.emit('set-role', 'pc', user?.uid);
      }
      showHint('✅ 接続成功');
    });

    s.on('devices-list', (list: any[]) => {
      const mobiles = list.filter(d => d.role === 'mobile' && d.id !== s.id);
      setConnectedMobiles(mobiles);
    });

    s.on('mobile-screen-data', (info: { id: string, data: string }) => {
      setMobileScreenData(info.data);
    });

    s.on('device-left', (data) => {
      setConnectedMobiles(prev => prev.filter(m => m.id !== data.id));
      if (selectedDisplay === 0 && connectedMobiles.length === 0) {
        setMobileScreenData(null);
      }
    });

    s.on('message-to-mobile', (data) => {
      if (data.type === 'vibrate') {
        if (navigator.vibrate) navigator.vibrate(200);
        showHint('📳 PCから振動要求');
      } else if (data.type === 'alert') {
        alert("PCからのメッセージ: " + data.msg);
      } else if (data.type === 'open-url') {
        const newWin = window.open(data.url, '_blank');
        if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
          alert("⚠️ ブラウザによって外部サイトの表示がブロックされました。設定からこのサイトの「ポップアップとリダイレクト」を許可してください。");
        }
      } else if (data.type === 'ping') {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(e => console.error("Audio error:", e));
        showHint('🔔 PCが呼び出しています');
      }
    });

    s.on('mobile-input-command', (data) => {
      if (data.type === 'click') {
        showHint(`🔥 PC操作受信: (${Math.round(data.x * 100)}, ${Math.round(data.y * 100)})`);
      }
    });

    s.on('message-to-pc', (data) => {
      if (data.type === 'status') {
        setConnectedMobiles(prev => prev.map(m => m.id === s.id ? { ...m, ...data } : m));
      }
    });

    s.on('connect_error', (err) => {
      setIsConnecting(false);
      console.error(`[Socket] Connection error (${token?.substring(0, 3)}...):`, err.message);

      const isVercel = window.location.hostname.includes('vercel.app');
      if (isVercel && !targetServerUrl && !forcedServerUrl) {
        setAuthError('接続先(サーバー)が見つかりません。PC側の「再生成」ボタンを押して、新しいQRコードを読み取ってください。');
      } else {
        setAuthError(`接続失敗: ${err.message === 'xhr poll error' ? 'サーバー(PC)がオフラインです' : 'WebSocketエラー'}`);
      }

      const msg = err.message.toUpperCase();
      const isAuthError = msg.includes('AUTH') || msg.includes('FAILED') || msg.includes('TOKEN') || msg.includes('EXPIRED') || msg.includes('RETRY');

      if (token === 'pc-internal') {
        console.warn("[Socket] PC-side connection failed. Check server status.");
      } else if (isAuthError) {
        s.close();
        localStorage.removeItem('remote_token');
        if (!isMobile) {
          console.log("[Socket] Invalid token on PC. Falling back to pc-internal...");
          setSocket(null);
          setTimeout(() => init('pc-internal'), 500);
        } else {
          setAuthError('認証が切れました。新しいパスワードを入力してください。');
          setShowPasswordLogin(true);
          setSocket(null);
        }
      }
    });

    s.on('clipboard-updated', setClipboard);
    s.on('system-stats', setStats);
    s.on('screenshot-data', setSs);
    s.on('displays-list', setDisplays);
  };

  const refresh = async () => {
    setTempPassword('生成中...');
    try {
      const r = await fetch('/api/network');
      const d = await r.json();

      if (d.ips && d.ips.length) {
        setIpAddress(d.ips[0]);
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        // スマホが接続すべきベースURLを決定
        // Vercelで開いている場合は、自分ではなく自宅PC(localhost/IP)を指す必要がある
        let baseUrl = window.location.origin;
        if (window.location.hostname.includes('vercel.app')) {
          baseUrl = `http://${d.ips[0]}:${d.port}`;
        } else if (isLocal) {
          baseUrl = `http://${d.ips[0]}:${d.port}`;
        }

        // QRコードに含めるURL
        // スマホはVercelのページを開きつつ、serverパラメータで自宅のPC(baseUrl)を指定する
        const publicFrontendUrl = window.location.hostname.includes('vercel.app') ? window.location.origin : baseUrl;
        const qrContent = `${publicFrontendUrl}?token=${d.token}&server=${encodeURIComponent(baseUrl)}`;

        QRCode.toDataURL(qrContent, { width: 400, margin: 2, color: { dark: '#10b981', light: '#ffffff' } }).then(setQrCode);

        // サーバー側のパスワード（PIN）を取得または設定
        const pass = d.password;
        let idToken = '';
        if (user) {
          try { idToken = await user.getIdToken(true); } catch (e) { }
        }

        const authRes = await fetch('/api/auth', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': idToken ? `Bearer ${idToken}` : ''
          },
          body: JSON.stringify({ password: pass })
        });

        if (authRes.ok) {
          setTempPassword(pass);
          // Firebaseに接続情報を同期 (スマホがVercel経由で見つけられるようにする)
          if (user) {
            set(ref(db, `users/${user.uid}/connection`), {
              password: pass,
              token: d.token,
              server: baseUrl,
              updatedAt: Date.now()
            });
          }
        } else {
          setTempPassword('ERR');
          showHint('パスワード登録失敗');
        }
      } else {
        setTempPassword('IPなし');
        setAuthError('QRコードの生成に失敗しました。ネットワーク設定を確認してください。');
      }
    } catch (e) {
      console.error(e);
      setTempPassword('ERROR');
      setAuthError('QRコードの生成中にエラーが発生しました。');
    }
  };

  const loginWithPassword = async () => {
    if (passwordInput.length < 6) return;
    setIsConnecting(true);
    setAuthError('');
    showHint('⚡ 認証中...');

    try {
      // 1. ローカルAPIでの認証を試みる (同じネットワーク内の場合)
      const idToken = await user?.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ password: passwordInput })
      });
      const data = await res.json();

      if (data.success) {
        localStorage.setItem('remote_token', data.token);
        init(data.token);
        setShowPasswordLogin(false);
        return;
      }

      // 2. Firebaseに保存された接続情報を確認 (Vercel経由の場合)
      if (user) {
        const { get, ref: dbRef } = await import('firebase/database');
        const snap = await get(dbRef(db, `users/${user.uid}/connection`));
        const conn = snap.val();

        if (conn && conn.password === passwordInput) {
          localStorage.setItem('remote_token', conn.token);
          if (conn.server) {
            localStorage.setItem('remote_server', conn.server);
            setTargetServerUrl(conn.server);
          }
          init(conn.token, conn.server);
          setShowPasswordLogin(false);
          return;
        }
      }

      setIsConnecting(false);
      setAuthError('パスワードが正しくありません。最新の番号を入力してください。');
    } catch (e) {
      console.error(e);
      setIsConnecting(false);
      setAuthError('通信エラーが発生しました。インターネット接続を確認してください。');
    }
  };

  const startMobileSharing = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showHint('⚠️ セキュリティ(HTTPS)またはブラウザの制限により画面共有が利用できません');
      console.error("Screen sharing not supported or insecure context.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false // モバイルでの互換性のため明示的にfalse
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      setIsSharingMobileScreen(true);
      showHint('📡 配信開始');

      const interval = setInterval(() => {
        if (!stream.active) {
          clearInterval(interval);
          setIsSharingMobileScreen(false);
          return;
        }
        canvas.width = video.videoWidth / 2;
        canvas.height = video.videoHeight / 2;
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.6);
        emit('mobile-screen-data', data);
      }, 100);

      stream.getVideoTracks()[0].onended = () => {
        clearInterval(interval);
        setIsSharingMobileScreen(false);
      };
    } catch (e: any) {
      console.error("Screen sharing error:", e);
      if (e.name === 'NotAllowedError') {
        showHint('⚠️ 画面共有の権限が拒否されました');
      } else {
        showHint('⚠️ 画面共有に失敗しました');
      }
      setIsSharingMobileScreen(false);
    }
  };

  const handleRemoteMobileInput = (e: React.MouseEvent | React.TouchEvent) => {
    if (!mobileScreenData) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    // 0-1の範囲に正規化して送信
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    emit('mobile-input', { type: 'click', x, y });
    showHint(`👆 (x:${x.toFixed(2)}, y:${y.toFixed(2)})`);
  };

  const touchData = useRef({ startTime: 0, startX: 0, startY: 0, moved: 0 });

  const onStart = (e: React.TouchEvent) => {
    fingers.current = e.touches.length;
    last.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchData.current = {
      startTime: Date.now(),
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      moved: 0
    };

    if (e.touches.length === 2) {
      scrollY.current = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setScroll(true);
    }
    if (tab === 'draw') emit('mouse-toggle', { down: true, button: 'left' });
    setActive(true);
  };

  const onMove = useCallback((e: React.TouchEvent) => {
    if (!socket?.connected) return;
    const dx = e.touches[0].clientX - last.current.x;
    const dy = e.touches[0].clientY - last.current.y;
    touchData.current.moved += Math.sqrt(dx * dx + dy * dy);

    // 指の位置を記録
    const rect = e.currentTarget.getBoundingClientRect();
    setTouchIndicator({
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top
    });

    if (tab === 'draw') {
      emit('mouse-drag', { dx, dy, sensitivity: sens });
    } else if (e.touches.length === 1 && !scroll) {
      emit('mouse-move', { dx, dy, sensitivity: sens });
    } else if (e.touches.length === 2) {
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const delta = (scrollY.current - y) * 0.1 * scrollSens;
      if (Math.abs(delta) > 0.3) {
        emit('mouse-scroll', { dy: delta });
        scrollY.current = y;
      }
    }
    last.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, [socket, sens, scrollSens, scroll, tab]);

  const onEnd = () => {
    const duration = Date.now() - touchData.current.startTime;
    const moved = touchData.current.moved;

    // タップ判定 (Macのトラックパッド風)
    if (duration < 250 && moved < 10) {
      if (fingers.current === 1) {
        emit('mouse-click', 'left');
        showHint('👆 左クリック (タップ)');
      } else if (fingers.current === 2) {
        emit('mouse-click', 'right');
        showHint('✌️ 右クリック (2本指タップ)');
      }
    } else if (fingers.current === 2 && scroll && moved < 30) {
      // スクロールせず2本指を離した際（右クリック）
      emit('mouse-click', 'right');
    }

    if (tab === 'draw') {
      emit('mouse-toggle', { down: false, button: 'left' });
    }
    setActive(false);
    setScroll(false);
    setTouchIndicator(null);
  };

  const showHint = (msg: string) => {
    setHint(msg);
    if (navigator.vibrate) navigator.vibrate(10);
    setTimeout(() => setHint(''), 1500);
  };
  const click = (b: 'left' | 'right' | 'middle', d = false) => { emit('mouse-click', b, d); showHint(b); };
  const keyTap = (k: string, m: string[] = []) => { emit('key-tap', k, m); showHint(k); };
  const macro = (m: any) => { emit('custom-macro', { keys: m.k, modifiers: m.m }); showHint(m.n); };

  const launch = (q: string, name: string) => {
    macro({ k: ['space'], m: ['command'], n: 'Spotlight' });
    setTimeout(() => {
      emit('type-string', q);
      setTimeout(() => { keyTap('enter'); showHint(`🚀 ${name}`); }, 400);
    }, 400);
  };

  const media = (a: string) => { emit('media-control', a); showHint(a); };
  const getSS = () => { emit('get-screenshot'); showHint('📸 取得中...'); };

  const getConnectionDuration = () => {
    if (!connectionTime) return '未接続';
    const now = new Date();
    const diff = Math.floor((now.getTime() - connectionTime.getTime()) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${m}分 ${s}秒`;
    // tickを利用して再レンダリングをトリガー
    console.debug('Timer tick:', tick);
  };

  const handleSignIn = async () => {
    setAuthError('');

    // セキュリティ環境のチェック
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      alert("⚠️ セキュリティ保護されていない接続(HTTP)からはログインできません。\n\nngrokやVercelの【https://】で始まるURLからアクセスしているか確認してください。もしIPアドレス(192.168...)で開いている場合は、ngrokのURLを使ってください。");
      return;
    }

    try {
      if (isMobile) {
        // スマホの場合はポップアップを試すとブロックされやすいため、最初からリダイレクトを実行
        await signInWithRedirect(auth, googleProvider);
      } else {
        // デスクトップはポップアップの方が使い勝手が良いため継続
        await signInWithPopup(auth, googleProvider);
      }
    } catch (e: any) {
      console.error("Login attempt error:", e.code, e);

      // ポップアップがブロックされた場合のフォールバック（主にデスクトップ用）
      if (!isMobile && (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request')) {
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (re: any) {
          alert("ログインを開始できませんでした。ブラウザの設定でポップアップとリダイレクトを許可してください。");
        }
      } else if (e.code !== 'auth/popup-closed-by-user') {
        alert("⚠️ ログインに失敗しました。\n\n【原因の可能性】\n1. ブラウザの設定で「サイト越えトラッキングを防ぐ」がオンになっている\n2. Firebase Consoleで、現在のドメイン(" + window.location.hostname + ")が「承認済みドメイン」に追加されていない\n\n設定を確認してください。");
      }
    }
  };
  const handleSignOut = () => firebaseSignOut(auth);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-black text-emerald-500 animate-pulse">RemoteHub...</div>;

  if (!user) {
    return (
      <main style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: '#f8fafc',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Inter', sans-serif"
      }}>
        {/* 背景の装飾 */}
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '40%', height: '40%', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '50%', filter: 'blur(100px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '40%', height: '40%', background: 'rgba(37, 99, 235, 0.05)', borderRadius: '50%', filter: 'blur(100px)', pointerEvents: 'none' }} />

        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{
            width: '100%',
            maxWidth: '400px',
            background: 'white',
            borderRadius: '32px',
            padding: '40px',
            boxShadow: '0 20px 60px -15px rgba(0,0,0,0.08)',
            border: '1px solid #f1f5f9',
            zIndex: 10,
            textAlign: 'center'
          }}
        >
          <img
            src="/icon.png"
            style={{
              width: '100px',
              height: '100px',
              borderRadius: '28px',
              margin: '0 auto 32px',
              boxShadow: '0 12px 30px -10px rgba(16,185,129,0.4)',
              objectFit: 'cover'
            }}
            alt="RemoteHub Logo"
          />

          <h1 style={{ fontSize: '32px', fontWeight: 900, color: '#0f172a', marginBottom: '8px', letterSpacing: '-0.03em' }}>RemoteHub</h1>
          <p style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, marginBottom: '40px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Unified Remote Control</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', textAlign: 'left', padding: '16px', borderRadius: '16px', background: '#f8fafc', border: '1px solid rgba(241,245,249,0.5)' }}>
              <div style={{ fontSize: '24px' }}>⚡</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>超低遅延</div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>スムーズな操作感を提供します</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', textAlign: 'left', padding: '16px', borderRadius: '16px', background: '#f8fafc', border: '1px solid rgba(241,245,249,0.5)' }}>
              <div style={{ fontSize: '24px' }}>🛡️</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>安全な接続</div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>デバイス間は強力に暗号化されます</div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSignIn}
            style={{
              width: '100%',
              height: '64px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              background: '#0f172a',
              color: 'white',
              borderRadius: '20px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 10px 20px -5px rgba(15,23,42,0.3)',
              transition: 'all 0.2s ease'
            }}
          >
            <img src="https://www.google.com/favicon.ico" style={{ width: '20px', height: '20px', background: 'white', borderRadius: '4px', padding: '2px' }} alt="G" />
            <span style={{ fontWeight: 700, fontSize: '16px' }}>Googleでログイン</span>
          </button>

          <p style={{ marginTop: '12px', fontSize: '10px', color: '#64748b', fontWeight: 600 }}>
            ※ ログイン画面が開かない場合は、ブラウザの設定で<br />
            <strong>「ポップアップ」</strong>を許可してください。
          </p>

          <p style={{ marginTop: '32px', fontSize: '11px', color: '#94a3b8', fontWeight: 500, padding: '0 16px', lineHeight: 1.6 }}>
            ログインすることで、Googleアカウントに紐付けられたデバイス間での安全なリモート接続が有効になります。
          </p>
        </motion.div>

        <footer style={{ marginTop: '32px', fontSize: '10px', fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '4px', opacity: 0.8, zIndex: 10 }}>
          Professional Edition 2026
        </footer>
      </main>
    );
  }

  // PC Screen
  if (!isMobile) {
    const activeMobile = connectedMobiles[0];

    return (
      <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#1e293b', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ maxWidth: '1800px', margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100vh', padding: '24px', gap: '24px' }}>

          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', background: '#fff', borderRadius: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <img
                src="/icon.png"
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '14px',
                  boxShadow: '0 4px 12px rgba(16,185,129,0.2)',
                  objectFit: 'cover'
                }}
                alt="R"
              />
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a' }}>RemoteHub <span style={{ color: '#10b981', fontSize: '13px', background: '#dcfce7', padding: '3px 8px', borderRadius: '6px', marginLeft: '6px' }}>PRO</span></h1>
                <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                  <span>● Online</span>
                  <span>🌍 {ipAddress}</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={refresh} className="btn btn-secondary" style={{ padding: '10px 20px' }}>🔄 再生成</button>
              <button onClick={handleSignOut} style={{ background: '#1e293b', color: '#fff', padding: '10px 24px', borderRadius: '14px', border: 'none', fontWeight: 700, cursor: 'pointer' }}>ログアウト</button>
            </div>
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr 400px', gap: '24px', flex: 1, minHeight: 0 }}>

            {/* 左: ペアリング & 接続リスト */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
              <div className="card" style={{ padding: '32px', textAlign: 'center', border: 'none' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>新規ペアリング</h3>
                <div style={{ width: '220px', height: '220px', margin: '0 auto 20px', background: '#fff', padding: '12px', border: '2px solid #f1f5f9', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {qrCode ? (
                    <img src={qrCode} style={{ width: '100%', height: '100%', borderRadius: '12px' }} alt="QR" />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                      <div className="animate-spin" style={{ width: '30px', height: '30px', border: '3px solid #f1f5f9', borderTopColor: '#10b981', borderRadius: '50%', margin: '0 auto 12px' }} />
                      <span style={{ fontSize: '12px' }}>QRコード生成中...</span>
                    </div>
                  )}
                </div>
                <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '16px', border: '1px solid #10b981' }}>
                  <p style={{ fontSize: '10px', fontWeight: 800, color: '#166534', letterSpacing: '0.1em' }}>OTP PIN</p>
                  <div style={{ fontSize: '36px', fontWeight: 900, color: '#064e3b', letterSpacing: '4px' }}>{tempPassword}</div>
                </div>
              </div>

              <div className="card" style={{ padding: '24px', flex: 1, border: 'none' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '20px', color: '#64748b', letterSpacing: '0.05em' }}>接続中のデバイス</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {connectedMobiles.length > 0 ? Array.from(new Set(connectedMobiles.map(m => m.id))).map(id => {
                    const m = connectedMobiles.find(x => x.id === id);
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: '#f8fafc', borderRadius: '16px', border: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: '24px' }}>📱</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 800 }}>Smartphone</div>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>ID: {id.substring(0, 8)}</div>
                        </div>
                        <div style={{ padding: '4px 8px', background: '#dcfce7', color: '#166534', borderRadius: '8px', fontSize: '9px', fontWeight: 800 }}>LIVE</div>
                      </div>
                    );
                  }) : (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}>
                      <p style={{ fontSize: '12px' }}>接続待ちデバイスはありません</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 中: メイン操作パネル (PCもスマホと同じ機能) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
              <div className="card" style={{ padding: '24px', border: 'none', background: '#fff' }}>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {[
                    { id: 'mouse', icon: '🖱️', n: 'マウス' },
                    { id: 'mirror', icon: '📡', n: 'ミラー' },
                    { id: 'monitor', icon: '📊', n: 'モニター' },
                    { id: 'macro', icon: '🚀', n: 'マクロ' },
                    { id: 'keys', icon: '⌨️', n: 'キー' },
                    { id: 'sync', icon: '📋', n: '同期' },
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id as Tab)}
                      style={{
                        padding: '12px 24px',
                        borderRadius: '16px',
                        border: 'none',
                        background: tab === t.id ? '#10b981' : '#f8fafc',
                        color: tab === t.id ? '#fff' : '#64748b',
                        fontWeight: 800,
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>{t.icon}</span> {t.n}
                    </button>
                  ))}
                </div>

                <div style={{ minHeight: '500px' }}>
                  {tab === 'mouse' && (
                    <div style={{ height: '500px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div className="trackpad" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 24, fontWeight: 900, color: '#e2e8f0' }}>PC CONTROL ACTIVE</span>
                      </div>
                      <div className="grid-3">
                        <button className="btn btn-secondary" style={{ height: 60 }} onClick={() => click('left')}>左クリック</button>
                        <button className="btn btn-secondary" style={{ height: 60 }} onClick={() => click('middle')}>中</button>
                        <button className="btn btn-secondary" style={{ height: 60 }} onClick={() => click('right')}>右クリック</button>
                      </div>
                    </div>
                  )}
                  {tab === 'mirror' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div className="grid-3">
                        {displays.map((d: any, i: number) => (
                          <button key={i} className={`btn ${selectedDisplay === i ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedDisplay(i)}>Display {i + 1}</button>
                        ))}
                      </div>
                      <button className="btn btn-primary" style={{ height: 60 }} onClick={() => {
                        if (!isMirroring) {
                          emit('start-mirroring', selectedDisplay);
                          setIsMirroring(true);
                          showHint('📡 ミラーリング開始');
                        } else {
                          emit('stop-mirroring');
                          setIsMirroring(false);
                        }
                      }}>{isMirroring ? '停止' : 'PC画面をミラー開始'}</button>
                      {ss && <img src={ss} style={{ width: '100%', borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} />}
                    </div>
                  )}
                  {tab === 'monitor' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div className="grid-2">
                        <div className="card" style={{ padding: 24, textAlign: 'center', borderBottom: '4px solid #4caf50' }}>
                          <p style={{ fontSize: 11, fontWeight: 800, color: '#9e9e9e' }}>CPU</p>
                          <p style={{ fontSize: 32, fontWeight: 900 }}>{stats.cpu}%</p>
                        </div>
                        <div className="card" style={{ padding: 24, textAlign: 'center', borderBottom: '4px solid #2196f3' }}>
                          <p style={{ fontSize: 11, fontWeight: 800, color: '#9e9e9e' }}>MEMORY</p>
                          <p style={{ fontSize: 32, fontWeight: 900 }}>{stats.mem}%</p>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
                        {displays.map((d: any, i: number) => (
                          <button key={i} onClick={() => { setSelectedDisplay(i); getSS(); }} className={`badge ${selectedDisplay === i ? 'badge-primary' : ''}`} style={{ whiteSpace: 'nowrap' }}>
                            🖥️ Display {i + 1}
                          </button>
                        ))}
                      </div>
                      <div className="card" style={{ padding: 16, background: '#000', minHeight: 240, position: 'relative' }}>
                        {ss ? <img src={ss} style={{ width: '100%', borderRadius: 8 }} /> : (
                          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <button onClick={getSS} className="btn" style={{ background: '#222', color: '#fff' }}>画面取得</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {tab === 'macro' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      <div className="grid-3">
                        {shortcuts.map(s => <button key={s.n} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={() => macro(s)}><span style={{ fontSize: 32 }}>{s.icon}</span><span style={{ fontWeight: 800 }}>{s.n}</span></button>)}
                      </div>
                      <div className="grid-5">
                        {launchers.map(l => <button key={l.n} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }} onClick={() => launch(l.q, l.n)}><span style={{ fontSize: 20 }}>{l.icon}</span><span style={{ fontSize: 10, fontWeight: 800 }}>{l.n}</span></button>)}
                      </div>
                    </div>
                  )}
                  {tab === 'keys' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <textarea className="textarea" style={{ height: 160, fontSize: 16 }} placeholder="ここに文字を入力してPCへ送信..." value={text} onChange={e => setText(e.target.value)} />
                      <button className="btn btn-primary" style={{ height: 60, fontSize: 18 }} onClick={() => { emit('type-string', text); setText(''); }}>PCへ送信</button>
                      <div className="grid-4">
                        {['enter', 'backspace', 'tab', 'escape'].map(k => <button key={k} className="btn btn-secondary" onClick={() => keyTap(k)}>{k.toUpperCase()}</button>)}
                      </div>
                    </div>
                  )}
                  {tab === 'sync' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <textarea className="textarea" style={{ height: 300 }} value={clipboard} onChange={e => { setClipboard(e.target.value); emit('sync-clipboard', e.target.value); }} />
                      <div className="grid-2">
                        <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(clipboard)}>コピー</button>
                        <button className="btn btn-secondary" onClick={() => navigator.clipboard.readText().then(setClipboard)}>貼り付け</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 右: リモートスマホ ビューア */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
              <div className="card" style={{ padding: '24px', border: 'none', background: '#1e293b', color: '#fff' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#94a3b8', marginBottom: '16px' }}>PC STATUS</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#10b981' }}>CPU</div>
                    <div style={{ fontSize: '24px', fontWeight: 900 }}>{stats.cpu}%</div>
                  </div>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#3b82f6' }}>RAM</div>
                    <div style={{ fontSize: '24px', fontWeight: 900 }}>{stats.mem}%</div>
                  </div>
                </div>
              </div>

              {activeMobile ? (
                <div className="card" style={{ padding: '24px', border: 'none', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800 }}>📱 リモート操作パネル</h3>
                  <div
                    style={{ aspectRatio: '9/19', background: '#000', borderRadius: '32px', border: '8px solid #0f172a', overflow: 'hidden', position: 'relative', cursor: 'crosshair' }}
                    onClick={handleRemoteMobileInput}
                  >
                    {mobileScreenData ? (
                      <img src={mobileScreenData} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="M" />
                    ) : (
                      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.3, textAlign: 'center' }}>
                        <span style={{ fontSize: 48 }}>📡</span>
                        <p style={{ fontSize: 11, marginTop: 12 }}>画面共有待機中</p>
                      </div>
                    )}
                  </div>
                  <div className="grid-2">
                    <button className="btn btn-secondary" onClick={() => emit('pc-to-mobile', { type: 'ping' })}>🔔 呼出</button>
                    <button className="btn btn-secondary" onClick={() => emit('pc-to-mobile', { type: 'vibrate' })}>📳 振動</button>
                  </div>
                </div>
              ) : (
                <div className="card" style={{ padding: '48px 24px', border: '2px dashed #e2e8f0', background: 'transparent', textAlign: 'center' }}>
                  <p style={{ fontSize: '12px', color: '#94a3b8' }}>スマホを接続すると<br />リモート画面が表示されます</p>
                </div>
              )}
            </div>

          </div>
        </div>
      </main>
    );
  }

  // Mobile Screen: Connected (or Firebase Relay ready)
  if (isMobile && (socket?.connected || (user && !isConnecting && (targetServerUrl || localStorage.getItem('remote_token'))))) {
    return (
      <main style={{ minHeight: '100vh', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', padding: 16, background: '#fafafa' }}>
        {(authError && (authError.includes('WebSocket') || authError.includes('オフライン'))) && (
          <div style={{ position: 'fixed', top: 80, left: 16, right: 16, background: '#fff9c4', padding: '8px 16px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: '#f57f17', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📡 Vercel制限により中継モードで動作中</span>
            <button onClick={() => setAuthError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 14 }}>×</button>
          </div>
        )}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '12px 16px', background: 'white', borderRadius: 20, boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={user.photoURL || ''} style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${socket?.connected ? '#4caf50' : '#2196f3'}` }} alt="" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{user.displayName}</div>
              <div style={{ fontSize: 9, color: '#9e9e9e' }}>{socket?.connected ? getConnectionDuration() + ' 直結中' : '📡 Firebase中継'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => {
                if (isSharingMobileScreen) {
                  showHint('⏹ 画面共有を終了してください');
                } else {
                  startMobileSharing();
                }
              }}
              className={`badge ${isSharingMobileScreen ? 'badge-danger' : 'badge-primary'}`}
              style={{ fontSize: 9, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {isSharingMobileScreen ? '⏹ 配信中' : '📡 画面共有'}
            </button>
            <div className="badge badge-success" style={{ fontSize: 8 }}>CPU {stats.cpu}%</div>
            <div className="badge" style={{ background: '#e3f2fd', color: '#1976d2', fontSize: 8 }}>RAM {stats.mem}%</div>
          </div>
        </header>

        <div style={{ marginBottom: 24 }}>
          <AnimatePresence mode="wait">
            {tab === 'mouse' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key="mouse">
                <div
                  className="card"
                  style={{
                    height: '50vh',
                    background: 'white',
                    borderRadius: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.03)',
                    touchAction: 'none'
                  }}
                  onContextMenu={e => e.preventDefault()}
                  onTouchStart={onStart}
                  onTouchMove={onMove}
                  onTouchEnd={onEnd}
                >
                  {!active && !scroll && <div style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 800, textAlign: 'center' }}>TOUCHPAD<br /><span style={{ fontSize: 11, fontWeight: 500, opacity: 0.5 }}>2本指でスクロール / タップでクリック</span></div>}
                  {scroll && <div style={{ color: '#2196f3', fontSize: 24 }}>↕️</div>}
                  {touchIndicator && (
                    <div style={{ position: 'absolute', left: touchIndicator.x - 20, top: touchIndicator.y - 20, width: 40, height: 40, background: 'rgba(16, 185, 129, 0.2)', border: '2px solid #10b981', borderRadius: '50%', pointerEvents: 'none' }} />
                  )}
                </div>
                <div className="grid-3" style={{ marginTop: 16 }}>
                  <button className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`} style={{ height: 64, borderRadius: 20 }} onTouchStart={() => { emit('mouse-toggle', { down: true, button: 'left' }); setActive(true); }} onTouchEnd={() => { emit('mouse-toggle', { down: false, button: 'left' }); setActive(false); }}>HOLD</button>
                  <button className="btn btn-secondary" style={{ height: 64, borderRadius: 20 }} onClick={() => click('left')}>LEFT</button>
                  <button className="btn btn-secondary" style={{ height: 64, borderRadius: 20 }} onClick={() => click('right')}>RIGHT</button>
                </div>
              </motion.div>
            )}

            {tab === 'mirror' && (
              <motion.div key="mirror" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12 }}>
                  {displays.map((d: any, i: number) => (
                    <button key={i} onClick={() => setSelectedDisplay(i)} className={`badge ${selectedDisplay === i ? 'badge-primary' : ''}`} style={{ whiteSpace: 'nowrap' }}>🖥️ Disp {i + 1}</button>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ height: 60 }} onClick={() => {
                  if (!isMirroring) {
                    emit('start-mirroring', selectedDisplay);
                    setIsMirroring(true);
                    showHint('📡 ミラーリング開始');
                  } else {
                    emit('stop-mirroring');
                    setIsMirroring(false);
                  }
                }}>{isMirroring ? '停止' : 'PC画面をミラー開始'}</button>
                {ss && <img src={ss} style={{ width: '100%', borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.1)', marginTop: 16 }} />}
              </motion.div>
            )}
            {tab === 'monitor' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="grid-2">
                  <div className="card" style={{ padding: 24, textAlign: 'center', borderBottom: '4px solid #4caf50' }}>
                    <p style={{ fontSize: 11, fontWeight: 800, color: '#9e9e9e' }}>CPU</p>
                    <p style={{ fontSize: 32, fontWeight: 900 }}>{stats.cpu}%</p>
                  </div>
                  <div className="card" style={{ padding: 24, textAlign: 'center', borderBottom: '4px solid #2196f3' }}>
                    <p style={{ fontSize: 11, fontWeight: 800, color: '#9e9e9e' }}>MEMORY</p>
                    <p style={{ fontSize: 32, fontWeight: 900 }}>{stats.mem}%</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
                  {displays.map((d: any, i: number) => (
                    <button key={i} onClick={() => { setSelectedDisplay(i); getSS(); }} className={`badge ${selectedDisplay === i ? 'badge-primary' : ''}`} style={{ whiteSpace: 'nowrap' }}>🖥️ Display {i + 1}</button>
                  ))}
                </div>
                <div className="card" style={{ padding: 16, background: '#000', minHeight: 240, position: 'relative' }}>
                  {ss ? <img src={ss} style={{ width: '100%', borderRadius: 8 }} /> : (
                    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <button onClick={getSS} className="btn" style={{ background: '#222', color: '#fff' }}>画面取得</button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {tab === 'macro' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="grid-3">
                  {shortcuts.map(s => <button key={s.n} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={() => macro(s)}><span style={{ fontSize: 32 }}>{s.icon}</span><span style={{ fontWeight: 800 }}>{s.n}</span></button>)}
                </div>
                <div className="grid-5">
                  {launchers.map(l => <button key={l.n} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }} onClick={() => launch(l.q, l.n)}><span style={{ fontSize: 20 }}>{l.icon}</span><span style={{ fontSize: 10, fontWeight: 800 }}>{l.n}</span></button>)}
                </div>
              </div>
            )}
            {tab === 'keys' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <textarea className="textarea" style={{ height: 160, fontSize: 16 }} placeholder="ここに文字を入力してPCへ送信..." value={text} onChange={e => setText(e.target.value)} />
                <button className="btn btn-primary" style={{ height: 60, fontSize: 18 }} onClick={() => { emit('type-string', text); setText(''); }}>PCへ送信</button>
                <div className="grid-4">
                  {['enter', 'backspace', 'tab', 'escape'].map(k => <button key={k} className="btn btn-secondary" onClick={() => keyTap(k)}>{k.toUpperCase()}</button>)}
                </div>
              </div>
            )}
            {tab === 'media' && (
              <div className="card" style={{ padding: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 32, marginBottom: 32 }}>
                  <button className="btn btn-secondary" style={{ width: 80, height: 80, fontSize: 32, borderRadius: 40 }} onClick={() => media('audio_prev')}>⏮</button>
                  <button className="btn btn-primary" style={{ width: 100, height: 100, fontSize: 40, borderRadius: 50 }} onClick={() => media('audio_play')}>⏯</button>
                  <button className="btn btn-secondary" style={{ width: 80, height: 80, fontSize: 32, borderRadius: 40 }} onClick={() => media('audio_next')}>⏭</button>
                </div>
                <div className="grid-3">
                  <button className="btn btn-secondary" style={{ height: 60, fontSize: 24 }} onClick={() => media('audio_vol_down')}>🔉</button>
                  <button className="btn btn-secondary" style={{ height: 60, fontSize: 24 }} onClick={() => media('audio_mute')}>🔇</button>
                  <button className="btn btn-secondary" style={{ height: 60, fontSize: 24 }} onClick={() => media('audio_vol_up')}>🔊</button>
                </div>
              </div>
            )}
            {tab === 'num' && (
              <div className="card" style={{ padding: 24, maxWidth: 300, margin: '0 auto' }}>
                <div className="grid-3" style={{ gap: 12 }}>
                  {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', 'enter'].map(k => (
                    <button key={k} className="btn btn-secondary" style={{ height: 64, fontSize: 24, fontWeight: 900 }} onClick={() => keyTap(k === 'enter' ? 'enter' : k)}>{k.toUpperCase()}</button>
                  ))}
                  <button className="btn btn-danger" style={{ height: 64, gridColumn: 'span 3' }} onClick={() => keyTap('backspace')}>DEL</button>
                </div>
              </div>
            )}
            {tab === 'power' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="grid-2">
                  <button className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={() => emit('system-control', 'sleep')}>
                    <span style={{ fontSize: 32 }}>🌙</span>
                    <span style={{ fontWeight: 800 }}>スリープ</span>
                  </button>
                  <button className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={() => emit('system-control', 'lock')}>
                    <span style={{ fontSize: 32 }}>🔒</span>
                    <span style={{ fontWeight: 800 }}>ロック</span>
                  </button>
                </div>
                <div className="card" style={{ padding: 24 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 16 }}>システム</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button className="btn btn-secondary" style={{ height: 52, justifyContent: 'flex-start', padding: '0 20px', gap: 12 }}
                      onClick={() => emit('system-control', 'display-settings')}
                    >
                      <span style={{ fontSize: 18 }}>🖥️</span>
                      <span style={{ fontWeight: 800 }}>ディスプレイ設定</span>
                    </button>
                  </div>
                </div>
                <div className="card" style={{ padding: 24 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 16 }}>音量・輝度</h4>
                  <div className="grid-3" style={{ marginBottom: 16 }}>
                    <button className="btn btn-secondary" style={{ height: 60, fontSize: 20 }} onClick={() => emit('system-control', 'volume-down')}>🔉</button>
                    <button className="btn btn-secondary" style={{ height: 60, fontSize: 20 }} onClick={() => emit('system-control', 'mute')}>🔇</button>
                    <button className="btn btn-secondary" style={{ height: 60, fontSize: 20 }} onClick={() => emit('system-control', 'volume-up')}>🔊</button>
                  </div>
                  <div className="grid-2">
                    <button className="btn btn-secondary" style={{ height: 52, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => emit('system-control', 'brightness-down')}>
                      <span>🔅</span> 輝度下げる
                    </button>
                    <button className="btn btn-secondary" style={{ height: 52, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => emit('system-control', 'brightness-up')}>
                      <span>🔆</span> 輝度上げる
                    </button>
                  </div>
                </div>
              </div>
            )}
            {tab === 'draw' && (
              <div className="card" style={{ padding: 12, borderRadius: 24 }}>
                <div style={{ height: '60vh', background: '#f1f5f9', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', position: 'relative', overflow: 'hidden' }}
                  onContextMenu={e => e.preventDefault()}
                  onTouchStart={onStart}
                  onTouchMove={onMove}
                  onTouchEnd={onEnd}
                >
                  <p style={{ color: '#94a3b8', fontSize: 13, fontWeight: 800 }}>DRAG TO DRAW</p>
                  {touchIndicator && (
                    <div style={{ position: 'absolute', left: touchIndicator.x - 10, top: touchIndicator.y - 10, width: 20, height: 20, background: '#f43f5e', borderRadius: '50%', pointerEvents: 'none' }} />
                  )}
                </div>
              </div>
            )}
            {tab === 'sync' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="card" style={{ padding: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 900, marginBottom: 16 }}>クリップボード</h4>
                  <textarea className="textarea" style={{ height: 240, marginBottom: 16 }} value={clipboard} onChange={e => { setClipboard(e.target.value); emit('sync-clipboard', e.target.value); }} />
                  <div className="grid-2">
                    <button className="btn btn-secondary" onClick={() => emit('get-clipboard')}>取得</button>
                    <button className="btn btn-primary" onClick={() => emit('sync-clipboard', clipboard)}>送信</button>
                  </div>
                </div>
                <div className="card" style={{ padding: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 900, marginBottom: 16 }}>URLを開く</h4>
                  <input type="text" className="input" placeholder="https://..." value={text} onChange={e => setText(e.target.value)} style={{ marginBottom: 16 }} />
                  <button className="btn btn-primary" style={{ width: '100%', height: 52 }} onClick={() => { emit('open-path', text); setText(''); }}>送信</button>
                </div>
              </div>
            )}
            {tab === 'config' && (
              <motion.div key="config" className="card" style={{ padding: 24 }}>
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span>速度</span><span>x{sens.toFixed(1)}</span></div>
                  <input type="range" min="0.5" max="5" step="0.1" value={sens} onChange={e => setSens(parseFloat(e.target.value))} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                  <div style={{ padding: 12, background: '#f8fafc', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src={user.photoURL || ''} style={{ width: 32, height: 32, borderRadius: '50%' }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{user.displayName}</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{user.email}</div>
                    </div>
                  </div>
                </div>
                <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 12 }} onClick={handleSignOut}>ログアウト</button>
                <button className="btn btn-danger" style={{ width: '100%', height: 60 }} onClick={() => { localStorage.removeItem('remote_token'); socket?.disconnect(); location.reload(); }}>接続解除</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <nav className="tab-bar">
          {[
            { id: 'mouse', icon: '🖱️', n: 'マウス' },
            { id: 'mirror', icon: '📡', n: 'ミラー' },
            { id: 'monitor', icon: '📊', n: 'モニター' },
            { id: 'keys', icon: '⌨️', n: 'キー' },
          ].map(t => (
            <button key={t.id} className={`tab-item ${tab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id as Tab); setShowMoreMenu(false); }}>
              <div className="tab-icon">{t.icon}</div>
              <span className="tab-label">{t.n}</span>
            </button>
          ))}
          <button className={`tab-item ${showMoreMenu ? 'active' : ''}`} onClick={() => setShowMoreMenu(!showMoreMenu)}>
            <div className="tab-icon">➕</div>
            <span className="tab-label">その他</span>
          </button>
        </nav>

        <AnimatePresence>
          {showMoreMenu && (
            <motion.div
              className="more-menu-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMoreMenu(false)}
            >
              <motion.div
                className="more-menu-content"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                onClick={e => e.stopPropagation()}
              >
                {[
                  { id: 'draw', icon: '🎨', n: 'お絵描き' },
                  { id: 'macro', icon: '🚀', n: 'マクロ' },
                  { id: 'media', icon: '🎵', n: 'メディア' },
                  { id: 'num', icon: '🔟', n: 'テンキー' },
                  { id: 'power', icon: '🌙', n: '電源' },
                  { id: 'sync', icon: '📋', n: '同期' },
                  { id: 'config', icon: '⚙️', n: '設定' },
                ].map(t => (
                  <button key={t.id} className="more-menu-item" onClick={() => { setTab(t.id as Tab); setShowMoreMenu(false); }}>
                    <div style={{ fontSize: 32 }}>{t.icon}</div>
                    <span style={{ fontSize: 11, fontWeight: 800 }}>{t.n}</span>
                  </button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hint && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ position: 'fixed', bottom: 100, left: 16, right: 16, background: '#212121', color: '#fff', padding: '14px 24px', borderRadius: 16, textAlign: 'center', zIndex: 100, fontWeight: 800 }}>{hint.toUpperCase()}</motion.div>
          )}
        </AnimatePresence>
      </main>
    );
  }

  // Mobile Screen: Unconnected / Connecting
  if (isMobile) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#fafafa' }}>
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
          {showScanner ? (
            <div className="card" style={{ padding: 24, borderRadius: 32, overflow: 'hidden' }}>
              <h3 style={{ marginBottom: 20, fontWeight: 900, fontSize: 18 }}>QRコードを読み取る</h3>
              <div id="reader" style={{ width: '100%', borderRadius: 16, overflow: 'hidden', background: '#000' }}></div>
              <div style={{ marginTop: 20, color: '#64748b', fontSize: 13, fontWeight: 600 }}>
                PC画面のQRコードを枠内に収めてください
              </div>
              <button
                onClick={() => setShowScanner(false)}
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: 24, height: 56, borderRadius: 16 }}
              >
                キャンセル
              </button>
            </div>
          ) : (
            <>
              <div style={{ width: 88, height: 88, borderRadius: 24, background: '#e3f2fd', color: '#1976d2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px' }}>
                <img src={user?.photoURL || ''} style={{ width: '100%', borderRadius: 24 }} alt="" />
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 16 }}>こんにちは、{user?.displayName?.split(' ')[0]}さん</h2>
              <p style={{ color: '#616161', marginBottom: 32, lineHeight: 1.6, fontSize: 14, padding: '0 20px' }}>
                接続を開始するには、PC画面に表示されているQRコードをよみ取るか、パスワードを入力してください。
              </p>
              {authError && <div className="badge badge-danger" style={{ marginBottom: 24, padding: '10px 16px' }}>{authError}</div>}

              {!showPasswordLogin ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <button onClick={() => setShowScanner(true)} className="btn btn-primary" style={{ height: 64, fontSize: 17 }}>スキャナーを起動</button>
                  <button onClick={() => setShowPasswordLogin(true)} className="btn btn-secondary" style={{ height: 60 }}>パスワードで入力</button>
                </div>
              ) : (
                <div className="card" style={{ padding: 24 }}>
                  {isConnecting ? (
                    <div style={{ padding: '20px 0' }}>
                      <div className="animate-spin" style={{ width: 40, height: 40, border: '4px solid #f1f5f9', borderTopColor: '#10b981', borderRadius: '50%', margin: '0 auto 20px' }}></div>
                      <p style={{ fontWeight: 800, color: '#10b981' }}>PCに接続中...</p>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        className="input"
                        placeholder="ABC123"
                        value={passwordInput}
                        maxLength={6}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck="false"
                        onChange={e => {
                          const val = e.target.value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
                          setPasswordInput(val.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                        }}
                        style={{ height: 72, fontSize: 32, textAlign: 'center', letterSpacing: 8, fontWeight: 900, marginBottom: 16 }}
                      />
                      <button onClick={loginWithPassword} className="btn btn-primary" style={{ width: '100%', height: 56 }}>接続する</button>
                    </>
                  )}
                  <button onClick={() => { setShowPasswordLogin(false); setIsConnecting(false); }} style={{ background: 'none', border: 'none', color: '#9e9e9e', fontWeight: 700, marginTop: 16 }}>キャンセル</button>
                </div>
              )}
            </>
          )}
        </motion.div>
      </main>
    );
  }

  return null;
}
