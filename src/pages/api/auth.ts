import { getNewToken } from './socket';

// 全域変数でパスワードを保持（Email -> { password, expiresAt }）
const getTempPasswords = () => {
    if (!(global as any)._tempPasswords) {
        (global as any)._tempPasswords = new Map<string, { pass: string, exp: number }>();
    }
    return (global as any)._tempPasswords as Map<string, { pass: string, exp: number }>;
};

// Firebase IDトークンからEmailを抽出する（簡易版: シグネチャ確認なし）
function verifyFirebaseToken(idToken: string): string | null {
    try {
        const payloadBase64 = idToken.split('.')[1];
        if (!payloadBase64) return null;
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
        return payload.email || null;
    } catch (e) {
        console.error("[Auth] Token decode error:", e);
        return null;
    }
}

export default async function handler(req: any, res: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: '認証トークンが必要です' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const email = verifyFirebaseToken(idToken);

    if (!email) {
        return res.status(401).json({ success: false, message: '不正なユーザー認証です' });
    }

    const tempPasswords = getTempPasswords();

    if (req.method === 'POST') {
        const { password } = req.body;
        console.log(`[Firebase Auth] ${email} attempt with: "${password}"`);

        const data = tempPasswords.get(email);
        if (data && data.pass === password && data.exp > Date.now()) {
            const token = getNewToken();
            res.status(200).json({ success: true, token });
        } else {
            res.status(401).json({ success: false, message: 'パスワードが間違っているか、期限切れです' });
        }
    } else if (req.method === 'PUT') {
        const { password } = req.body;
        if (password && password.length === 6) {
            const expiresAt = Date.now() + 15 * 60 * 1000; // 15分
            tempPasswords.set(email, { pass: password, exp: expiresAt });
            console.log(`[Firebase Auth] Registered for ${email}: ${password}`);
            res.status(200).json({ success: true });
        } else {
            res.status(400).json({ success: false, message: 'Invalid password' });
        }
    } else {
        res.status(405).json({ message: 'Method not allowed' });
    }
}
