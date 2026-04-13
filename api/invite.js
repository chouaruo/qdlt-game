'use strict';

// 简单的内存计数（Vercel Serverless 冷启动会重置）
// 后续可接 Vercel KV / Redis 持久化
const counts = {};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // GET /api/invite?code=X7K9M2 → 查询积分
  if (req.method === 'GET') {
    const code = req.query?.code;
    if (!code) {
      res.status(400).json({ error: '缺少 code 参数' });
      return;
    }
    res.status(200).json({ code, points: counts[code] || 0 });
    return;
  }

  // POST /api/invite { ref: 'X7K9M2' } → 被邀请人访问，给邀请人加分
  if (req.method === 'POST') {
    const { ref } = req.body || {};
    if (!ref || typeof ref !== 'string' || ref.length !== 6) {
      res.status(400).json({ error: '无效的邀请码' });
      return;
    }
    counts[ref] = (counts[ref] || 0) + 10;
    res.status(200).json({ ref, points: counts[ref] });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
