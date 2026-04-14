'use strict';

// 内存存储（Vercel Serverless 冷启动会重置）
// 后续可接 Vercel KV / Redis 持久化
const counts = {};
const bscAddresses = {}; // inviteCode → bscAddr

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
    res.status(200).json({
      code,
      points: counts[code] || 0,
      bscAddr: bscAddresses[code] || null,
    });
    return;
  }

  // GET /api/invite?list=all → 导出所有 BSC 地址（发行方用）
  if (req.method === 'GET' && req.query?.list === 'all') {
    res.status(200).json({ addresses: bscAddresses, counts });
    return;
  }

  // POST /api/invite
  if (req.method === 'POST') {
    const { ref, bscAddr, action } = req.body || {};

    // 保存 BSC 地址
    if (action === 'save_addr' && ref && bscAddr) {
      if (/^0x[a-fA-F0-9]{40}$/.test(bscAddr)) {
        bscAddresses[ref] = bscAddr;
        console.log(`[BSC] ${ref} → ${bscAddr}`);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // 邀请加分
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
