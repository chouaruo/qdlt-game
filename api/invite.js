'use strict';

// Upstash Redis REST API（通过 Vercel 环境变量自动注入）
async function redis(command, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args]),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // GET /api/invite?code=X7K9M2 → 查询积分
  if (req.method === 'GET') {
    const code = req.query?.code;

    // 导出所有数据（发行方用）
    if (req.query?.list === 'all') {
      const keys = await redis('KEYS', 'user:*');
      const users = [];
      if (keys) {
        for (const key of keys) {
          const data = await redis('HGETALL', key);
          if (data) {
            const obj = {};
            for (let i = 0; i < data.length; i += 2) obj[data[i]] = data[i + 1];
            users.push(obj);
          }
        }
      }
      res.status(200).json({ total: users.length, users });
      return;
    }

    if (!code) { res.status(400).json({ error: '缺少 code 参数' }); return; }
    const points = await redis('HGET', `user:${code}`, 'points');
    const bscAddr = await redis('HGET', `user:${code}`, 'bscAddr');
    res.status(200).json({ code, points: Number(points) || 0, bscAddr: bscAddr || null });
    return;
  }

  // POST /api/invite
  if (req.method === 'POST') {
    const { ref, bscAddr, action } = req.body || {};

    // 保存 BSC 地址
    if (action === 'save_addr' && ref && bscAddr) {
      if (/^0x[a-fA-F0-9]{40}$/.test(bscAddr)) {
        await redis('HSET', `user:${ref}`, 'bscAddr', bscAddr, 'updatedAt', new Date().toISOString());
      }
      res.status(200).json({ ok: true });
      return;
    }

    // 邀请加分
    if (!ref || typeof ref !== 'string' || ref.length !== 6) {
      res.status(400).json({ error: '无效的邀请码' }); return;
    }
    const newPoints = await redis('HINCRBY', `user:${ref}`, 'points', 10);
    await redis('HSET', `user:${ref}`, 'code', ref, 'lastActive', new Date().toISOString());
    res.status(200).json({ ref, points: Number(newPoints) || 0 });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
