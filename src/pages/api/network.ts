import os from 'os';
import { getNewToken } from './socket';

export default function handler(req: any, res: any) {
    // 常に新しいトークンを生成（セキュアQR用）
    const token = getNewToken();
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    for (const k in interfaces) {
        for (const k2 in interfaces[k]!) {
            const address = interfaces[k]![k2];
            if (address.family === 'IPv4') {
                if (!address.internal) {
                    addresses.push(address.address);
                }
            }
        }
    }

    // fallback: 外部IPがない場合はlocalhostを返す
    if (addresses.length === 0) {
        addresses.push('127.0.0.1');
    }

    res.status(200).json({
        ips: addresses,
        port: 3000,
        token: token
    });
}
