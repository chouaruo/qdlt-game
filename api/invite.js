'use strict';

const crypto = require('crypto');

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

function fingerprint(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  return crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 16);
}

const ALLOWED_ORIGINS = ['https://qdlt-game.vercel.app','https://degenlife.gg','https://www.degenlife.gg','http://localhost:3000','http://localhost:3011'];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // GET /api/invite?code=X7K9M2 → 查询积分
  if (req.method === 'GET') {
    const code = req.query?.code;
    if (!code || typeof code !== 'string' || !/^[A-Za-z0-9]{4,8}$/.test(code)) {
      res.status(400).json({ error: '无效的邀请码' }); return;
    }
    const points = await redis('HGET', `user:${code}`, 'points');
    res.status(200).json({ code, points: Number(points) || 0 });
    return;
  }

  // POST /api/invite
  if (req.method === 'POST') {
    const { ref, myCode, bscAddr, action, code, amount, charId } = req.body || {};

    // ═══ 保存 BSC 地址 ═══
    if (action === 'save_addr' && ref && bscAddr) {
      if (!/^[A-Za-z0-9]{4,8}$/.test(ref)) { res.status(400).json({ error: '无效的邀请码' }); return; }
      if (/^0x[a-fA-F0-9]{40}$/.test(bscAddr)) {
        await redis('HSET', `user:${ref}`, 'bscAddr', bscAddr, 'updatedAt', new Date().toISOString());
      }
      res.status(200).json({ ok: true });
      return;
    }

    // ═══ 积分消费（解锁角色等） ═══
    if (action === 'spend') {
      if (!code || !/^[A-Za-z0-9]{4,8}$/.test(code)) {
        res.status(400).json({ error: '无效的邀请码' }); return;
      }
      const spendAmount = Number(amount);
      if (!spendAmount || spendAmount <= 0 || spendAmount > 1000) {
        res.status(400).json({ error: '无效的消费金额' }); return;
      }
      // 先读当前积分
      const current = Number(await redis('HGET', `user:${code}`, 'points')) || 0;
      if (current < spendAmount) {
        res.status(200).json({ ok: false, reason: 'insufficient', current });
        return;
      }
      // 扣减积分
      const remaining = await redis('HINCRBY', `user:${code}`, 'points', -spendAmount);
      // 记录消费日志
      await redis('RPUSH', `spend_log:${code}`, JSON.stringify({
        charId: charId || 'unknown',
        amount: spendAmount,
        time: new Date().toISOString()
      }));
      res.status(200).json({ ok: true, remaining: Number(remaining) || 0 });
      return;
    }

    // ═══ 邀请加分（三层防刷） ═══
    if (!ref || typeof ref !== 'string' || !/^[A-Za-z0-9]{6}$/.test(ref)) {
      res.status(400).json({ error: '无效的邀请码' }); return;
    }

    // 防刷层1：自刷检测（自己点自己链接）
    if (myCode && myCode === ref) {
      res.status(200).json({ ref, ok: false, reason: 'self_ref' });
      return;
    }

    // 防刷层2：IP+UA 指纹去重（同一设备7天内只算一次）
    const fp = fingerprint(req);
    const already = await redis('SISMEMBER', `visitors:${ref}`, fp);
    if (already) {
      const points = await redis('HGET', `user:${ref}`, 'points');
      res.status(200).json({ ref, ok: false, reason: 'duplicate', points: Number(points) || 0 });
      return;
    }

    // 通过验证，加分
    await redis('SADD', `visitors:${ref}`, fp);
    // visitors set 7天过期（防止无限膨胀）
    await redis('EXPIRE', `visitors:${ref}`, 604800);
    const newPoints = await redis('HINCRBY', `user:${ref}`, 'points', 10);
    await redis('HSET', `user:${ref}`, 'code', ref, 'lastActive', new Date().toISOString());
    res.status(200).json({ ref, ok: true, points: Number(newPoints) || 0 });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
