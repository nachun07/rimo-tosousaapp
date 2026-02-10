'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signInWithRedirect, signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';

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

  const last = useRef({ x: 0, y: 0 });
  const fingers = useRef(0);
  const scrollY = useRef(0);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

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

  useEffect(() => {
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
      } else if (!mobile) {
        refresh();
        init('pc-internal');
      }
    }
  }, [user]);

  useEffect(() => {
    if (showScanner) {
      if (!window.isSecureContext) {
        setAuthError("ブラウザの制限により、IPアドレス直接接続（HTTP）ではカメラが使えません。6桁のパスワードを入力してください。");
        setShowScanner(false);
        setShowPasswordLogin(true);
        return;
      }

      const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
      scannerRef.current = scanner;

      scanner.render((decodedText) => {
        try {
          const url = new URL(decodedText);
          const token = url.searchParams.get('token');
          if (token) {
            localStorage.setItem('remote_token', token);
            // 現在のドメインを維持して、トークンだけ適用してリロードする
            const nextUrl = new URL(window.location.origin);
            nextUrl.searchParams.set('token', token);
            window.location.href = nextUrl.toString();
          }
        } catch (e) {
          console.error("Invalid QR:", e);
        }
      }, (error) => { });

      return () => {
        if (scannerRef.current) {
          scannerRef.current.clear().catch(e => console.error(e));
        }
      };
    }
  }, [showScanner]);

  useEffect(() => {
    if (connectionTime) {
      const interval = setInterval(() => {
        setConnectionTime(new Date(connectionTime));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [connectionTime]);

  const init = async (token: string) => {
    const isVercel = window.location.hostname.includes('vercel.app');
    const connectUrl = targetServerUrl || (isVercel ? '' : window.location.origin);

    // Vercel自身ではなく、指定されたサーバー（自宅Mac）のSocket.IOを探しに行く
    const socketOptions = {
      path: '/api/socket',
      auth: { token },
      transports: ['websocket', 'polling']
    };

    const s = connectUrl ? io(connectUrl, socketOptions) : io(socketOptions);

    s.on('connect', () => {
      setSocket(s);
      setAuthError('');
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (mobile) {
        s.emit('set-role', 'mobile');
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
        s.emit('set-role', 'pc');
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
        window.open(data.url, '_blank');
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
      console.error(`[Socket] Connection error (${token?.substring(0, 3)}...):`, err.message);

      const msg = err.message.toUpperCase();
      const isAuthError = msg.includes('AUTH') || msg.includes('FAILED') || msg.includes('TOKEN') || msg.includes('EXPIRED') || msg.includes('RETRY');

      if (token === 'pc-internal') {
        console.warn("[Socket] PC-side auth failed (internal). Retrying refresh...");
        refresh();
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
    setQrCode('');
    try {
      const r = await fetch('/api/network');
      const d = await r.json();

      if (d.ips && d.ips.length) {
        setIpAddress(d.ips[0]);
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        // ngrokなどの公開URLがあればそれを優先し、なければローカルIPを使う
        const publicUrl = window.location.origin.includes('vercel.app') ? '' : window.location.origin;
        const baseUrl = publicUrl || (isLocal ? `http://${d.ips[0]}:${d.port}` : window.location.origin);
        const url = `${baseUrl}?token=${d.token}&server=${encodeURIComponent(baseUrl)}`;

        QRCode.toDataURL(url, { width: 400, margin: 2, color: { dark: '#10b981', light: '#ffffff' } }).then(setQrCode);

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
    if (passwordInput.length !== 6) return;
    setAuthError('');
    showHint('⚡ 認証中...');

    try {
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
      } else {
        setAuthError(data.message || 'パスワードが正しくありません。最新の番号を入力してください。');
      }
    } catch (e) {
      setAuthError('サーバーとの通信に失敗しました');
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
        socket?.emit('mobile-screen-data', data);
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

    socket?.emit('mobile-input', { type: 'click', x, y });
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
    if (tab === 'draw') socket?.emit('mouse-toggle', { down: true, button: 'left' });
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
      socket.emit('mouse-drag', { dx, dy, sensitivity: sens });
    } else if (e.touches.length === 1 && !scroll) {
      socket.emit('mouse-move', { dx, dy, sensitivity: sens });
    } else if (e.touches.length === 2) {
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const delta = (scrollY.current - y) * 0.1 * scrollSens;
      if (Math.abs(delta) > 0.3) {
        socket.emit('mouse-scroll', { dy: delta });
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
        socket?.emit('mouse-click', 'left');
        showHint('👆 左クリック (タップ)');
      } else if (fingers.current === 2) {
        socket?.emit('mouse-click', 'right');
        showHint('✌️ 右クリック (2本指タップ)');
      }
    } else if (fingers.current === 2 && scroll && moved < 30) {
      // スクロールせず2本指を離した際（右クリック）
      socket?.emit('mouse-click', 'right');
    }

    if (tab === 'draw') {
      socket?.emit('mouse-toggle', { down: false, button: 'left' });
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
  const click = (b: 'left' | 'right' | 'middle', d = false) => { socket?.emit('mouse-click', b, d); showHint(b); };
  const keyTap = (k: string, m: string[] = []) => { socket?.emit('key-tap', k, m); showHint(k); };
  const macro = (m: any) => { socket?.emit('custom-macro', { keys: m.k, modifiers: m.m }); showHint(m.n); };

  const launch = (q: string, name: string) => {
    macro({ k: ['space'], m: ['command'], n: 'Spotlight' });
    setTimeout(() => {
      socket?.emit('type-string', q);
      setTimeout(() => { keyTap('enter'); showHint(`🚀 ${name}`); }, 400);
    }, 400);
  };

  const media = (a: string) => { socket?.emit('media-control', a); showHint(a); };
  const getSS = () => { socket?.emit('get-screenshot'); showHint('📸 取得中...'); };

  const getConnectionDuration = () => {
    if (!connectionTime) return '未接続';
    const now = new Date();
    const diff = Math.floor((now.getTime() - connectionTime.getTime()) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${m}分 ${s}秒`;
  };

  const handleSignIn = () => {
    if (isMobile) {
      signInWithRedirect(auth, googleProvider);
    } else {
      signInWithPopup(auth, googleProvider);
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
                          socket?.emit('start-mirroring', selectedDisplay);
                          setIsMirroring(true);
                          showHint('📡 ミラーリング開始');
                        } else {
                          socket?.emit('stop-mirroring');
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
                      <button className="btn btn-primary" style={{ height: 60, fontSize: 18 }} onClick={() => { socket?.emit('type-string', text); setText(''); }}>PCへ送信</button>
                      <div className="grid-4">
                        {['enter', 'backspace', 'tab', 'escape'].map(k => <button key={k} className="btn btn-secondary" onClick={() => keyTap(k)}>{k.toUpperCase()}</button>)}
                      </div>
                    </div>
                  )}
                  {tab === 'sync' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <textarea className="textarea" style={{ height: 300 }} value={clipboard} onChange={e => { setClipboard(e.target.value); socket?.emit('sync-clipboard', e.target.value); }} />
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
                    <button className="btn btn-secondary" onClick={() => socket?.emit('pc-to-mobile', { type: 'ping' })}>🔔 呼出</button>
                    <button className="btn btn-secondary" onClick={() => socket?.emit('pc-to-mobile', { type: 'vibrate' })}>📳 振動</button>
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

  // Mobile Screen: Unconnected
  if (!socket?.connected) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#fafafa' }}>
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
          {showScanner ? (
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 16, fontWeight: 800 }}>QRコードをスキャン</h3>
              <div id="reader" style={{ width: '100%' }}></div>
              <button onClick={() => setShowScanner(false)} className="btn btn-secondary" style={{ width: '100%', marginTop: 16 }}>キャンセル</button>
            </div>
          ) : (
            <>
              <div style={{ width: 88, height: 88, borderRadius: 24, background: '#e3f2fd', color: '#1976d2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px' }}>
                <img src={user.photoURL || ''} style={{ width: '100%', borderRadius: 24 }} />
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>おかえりなさい、{user.displayName?.split(' ')[0]}さん</h2>
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
                  <input
                    type="text" className="input" placeholder="000000" value={passwordInput} maxLength={6}
                    onChange={e => setPasswordInput(e.target.value.replace(/\D/g, ''))}
                    style={{ height: 72, fontSize: 32, textAlign: 'center', letterSpacing: 8, fontWeight: 900, marginBottom: 16 }}
                  />
                  <button onClick={loginWithPassword} className="btn btn-primary" style={{ width: '100%', height: 56 }}>接続する</button>
                  <button onClick={() => setShowPasswordLogin(false)} style={{ background: 'none', border: 'none', color: '#9e9e9e', fontWeight: 700, marginTop: 16 }}>キャンセル</button>
                </div>
              )}
            </>
          )}
        </motion.div>
      </main>
    );
  }

  // Mobile Screen: Connected
  return (
    <main style={{ minHeight: '100vh', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', padding: 16, background: '#fafafa' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '12px 16px', background: 'white', borderRadius: 20, boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={user.photoURL || ''} style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid #4caf50' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{user.displayName}</div>
            <div style={{ fontSize: 9, color: '#9e9e9e' }}>{getConnectionDuration()} 接続中</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => {
              if (isSharingMobileScreen) {
                // 自動停止はTrack.onendedで処理される仕組み
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AnimatePresence mode="wait">
          {tab === 'mouse' && (
            <motion.div key="mouse" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className={`trackpad ${active ? 'trackpad-active' : ''}`} style={{ height: '52vh' }} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.05, pointerEvents: 'none' }}>
                  <span style={{ fontSize: 100, fontWeight: 900, letterSpacing: '20px' }}>TRACKPAD</span>
                </div>
                {touchIndicator && (
                  <div style={{
                    position: 'absolute',
                    left: touchIndicator.x,
                    top: touchIndicator.y,
                    width: 40,
                    height: 40,
                    background: 'rgba(76, 175, 80, 0.2)',
                    borderRadius: '50%',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    border: '2px solid rgba(76, 175, 80, 0.4)'
                  }} />
                )}
              </div>
              <div className="grid-3">
                <button className="btn btn-secondary" style={{ height: 64, fontWeight: 800 }} onClick={() => click('left')}>左</button>
                <button className="btn btn-secondary" style={{ height: 64, fontWeight: 800 }} onClick={() => click('middle')}>中</button>
                <button className="btn btn-secondary" style={{ height: 64, fontWeight: 800 }} onClick={() => click('right')}>右</button>
              </div>
            </motion.div>
          )}

          {tab === 'monitor' && (
            <motion.div key="monitor">
              <div className="grid-2" style={{ marginBottom: 16 }}>
                <div className="card" style={{ padding: 24, textAlign: 'center', borderBottom: '4px solid #4caf50' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#9e9e9e' }}>CPU</p>
                  <p style={{ fontSize: 32, fontWeight: 900 }}>{stats.cpu}%</p>
                </div>
                <div className="card" style={{ padding: 24, textAlign: 'center', borderBottom: '4px solid #2196f3' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#9e9e9e' }}>MEMORY</p>
                  <p style={{ fontSize: 32, fontWeight: 900 }}>{stats.mem}%</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 8 }}>
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
            </motion.div>
          )}

          {tab === 'mirror' && (
            <motion.div key="mirror">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {displays.map((d: any, i: number) => (
                    <button key={i} onClick={() => setSelectedDisplay(i)} className={`badge ${selectedDisplay === i ? 'badge-primary' : ''}`}>
                      {i + 1}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (!isMirroring) {
                      socket?.emit('start-mirroring', selectedDisplay);
                      setIsMirroring(true);
                      showHint('📡 ミラーリング開始');
                    } else {
                      socket?.emit('stop-mirroring');
                      setIsMirroring(false);
                    }
                  }}
                  className={`btn ${isMirroring ? 'btn-danger' : 'btn-primary'}`}
                  style={{ height: 40, fontSize: 12 }}
                >
                  {isMirroring ? '停止' : '配信開始'}
                </button>
              </div>
              <div
                className="card"
                style={{
                  padding: 4,
                  background: '#000',
                  minHeight: '40vh',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {ss && isMirroring ? (
                  <img
                    src={ss}
                    style={{
                      width: '100%',
                      height: 'auto',
                      maxHeight: '70vh',
                      objectFit: 'contain',
                      borderRadius: 12,
                      boxShadow: '0 0 20px rgba(0,0,0,0.5)'
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', color: '#666' }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
                    <p style={{ fontSize: 12, fontWeight: 800 }}>ミラーリングを待機中</p>
                  </div>
                )}

                {isMirroring && (
                  <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
                    <div className="badge badge-success" style={{ fontSize: 8, opacity: 0.8 }}>LIVE</div>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 12, textAlign: 'center' }}>
                ※高頻度でスクリーンショットを取得して配信しています
              </p>
            </motion.div>
          )}

          {tab === 'power' && (
            <motion.div key="power" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div className="grid-2">
                <button className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={() => socket?.emit('system-control', 'sleep')}>
                  <span style={{ fontSize: 32 }}>🌙</span>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>スリープ</span>
                </button>
                <button className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={() => socket?.emit('system-control', 'lock')}>
                  <span style={{ fontSize: 32 }}>🔒</span>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>画面をロック</span>
                </button>
              </div>

              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 16, color: '#64748b' }}>画面設定</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#1e293b' }}
                    onClick={() => socket?.emit('system-control', 'display-settings')}
                  >
                    <span>🖥️</span> PCの配置設定を開く
                  </button>
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '16px', border: '1px solid #f1f5f9' }}>
                    <p style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.6, fontWeight: 600 }}>
                      スマホを第2モニターにするには：<br />
                      1. PC側で「配置」を『拡張』にする<br />
                      2. ミラーリングタブでサブ画面を選ぶ
                    </p>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 16, color: '#64748b' }}>音量・明るさ</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="grid-3" style={{ gap: 8 }}>
                    <button className="btn btn-secondary" style={{ height: 60, fontSize: 20 }} onClick={() => socket?.emit('system-control', 'volume-down')}>🔉</button>
                    <button className="btn btn-secondary" style={{ height: 60, fontSize: 20 }} onClick={() => socket?.emit('system-control', 'mute')}>🔇</button>
                    <button className="btn btn-secondary" style={{ height: 60, fontSize: 20 }} onClick={() => socket?.emit('system-control', 'volume-up')}>🔊</button>
                  </div>
                  <div className="grid-2" style={{ gap: 8 }}>
                    <button className="btn btn-secondary" style={{ height: 52, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => socket?.emit('system-control', 'brightness-down')}>
                      <span style={{ fontSize: 18 }}>🔅</span>
                      <span>画面を暗く</span>
                    </button>
                    <button className="btn btn-secondary" style={{ height: 52, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => socket?.emit('system-control', 'brightness-up')}>
                      <span style={{ fontSize: 18 }}>🔆</span>
                      <span>画面を明るく</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'draw' && (
            <motion.div key="draw" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="badge" style={{ background: '#e8f5e9', color: '#2e7d32', padding: 12 }}>お絵描き・ドラッグ固定モード</div>
              <div className={`trackpad ${active ? 'trackpad-active' : ''}`} style={{ height: '55vh', border: '3px dashed #4caf50' }} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} />
              <button className="btn btn-danger" style={{ height: 60 }} onClick={() => keyTap('z', ['command'])}>UNDO</button>
            </motion.div>
          )}

          {tab === 'keys' && (
            <motion.div key="keys">
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <textarea className="textarea" placeholder="テキストを送信..." value={text} onChange={e => setText(e.target.value)} style={{ height: 100, marginBottom: 12 }} />
                <button className="btn btn-primary" style={{ width: '100%', height: 52 }} onClick={() => { socket?.emit('type-string', text); setText(''); }}>送信</button>
              </div>
              <div className="grid-4">
                {['enter', 'backspace', 'tab', 'escape', 'space', 'f1', 'f5', 'f11'].map(k => (
                  <button key={k} className="btn btn-secondary" style={{ fontSize: 11, padding: '16px 4px' }} onClick={() => keyTap(k)}>{k.toUpperCase()}</button>
                ))}
              </div>
            </motion.div>
          )}

          {tab === 'macro' && (
            <motion.div key="macro">
              <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20 }}>🔍</span>
                <input
                  className="input"
                  style={{ border: 'none', background: 'transparent', padding: 0 }}
                  placeholder="アプリを検索..."
                  value={appSearch}
                  onChange={e => setAppSearch(e.target.value)}
                />
              </div>

              <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 12, color: '#94a3b8' }}>SHORTCUTS</h4>
              <div className="grid-3" style={{ marginBottom: 32 }}>
                {shortcuts.map(s => (
                  <button key={s.n} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }} onClick={() => macro(s)}>
                    <span style={{ fontSize: 32 }}>{s.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 800 }}>{s.n}</span>
                  </button>
                ))}
              </div>

              <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 12, color: '#94a3b8' }}>LAUNCHERS</h4>
              <div className="grid-3" style={{ gap: 12 }}>
                {launchers.filter(l => l.n.toLowerCase().includes(appSearch.toLowerCase())).map(l => (
                  <button key={l.n} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }} onClick={() => launch(l.q, l.n)}>
                    <span style={{ fontSize: 32 }}>{l.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 800 }}>{l.n}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {tab === 'num' && (
            <motion.div key="num" className="grid-3" style={{ width: '100%', maxWidth: 300, margin: '0 auto' }}>
              {[7, 8, 9, 4, 5, 6, 1, 2, 3, 0, '.', 'enter'].map(n => (
                <button key={n} className="btn btn-secondary" style={{ height: 80, fontSize: 24 }} onClick={() => keyTap(n.toString())}>{n}</button>
              ))}
            </motion.div>
          )}

          {tab === 'media' && (
            <motion.div key="media" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
              <div style={{ display: 'flex', gap: 20 }}>
                <button onClick={() => media('audio_prev')} className="btn btn-secondary" style={{ width: 70, height: 70, fontSize: 32 }}>⏮️</button>
                <button onClick={() => keyTap('space')} className="btn btn-primary" style={{ width: 100, height: 100, fontSize: 48 }}>⏯️</button>
                <button onClick={() => media('audio_next')} className="btn btn-secondary" style={{ width: 70, height: 70, fontSize: 32 }}>⏭️</button>
              </div>
              <div className="grid-3" style={{ width: '100%' }}>
                <button className="btn btn-secondary" onClick={() => media('audio_vol_down')}>🔉</button>
                <button className="btn btn-secondary" onClick={() => media('audio_mute')}>🔇</button>
                <button className="btn btn-secondary" onClick={() => media('audio_vol_up')}>🔊</button>
              </div>
            </motion.div>
          )}

          {tab === 'sync' && (
            <motion.div key="sync">
              <textarea className="textarea" style={{ height: 240, marginBottom: 16 }} value={clipboard} onChange={e => { setClipboard(e.target.value); socket?.emit('sync-clipboard', e.target.value); }} />
              <div className="grid-2">
                <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(clipboard)}>コピー</button>
                <button className="btn btn-secondary" onClick={() => navigator.clipboard.readText().then(t => { setClipboard(t); })}>取得</button>
              </div>
            </motion.div>
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
