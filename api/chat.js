'use strict';

const { generateGameTurn } = require('../lib/chat');

const ALLOWED_ORIGINS = ['https://qdlt-game.vercel.app','http://localhost:3000','http://localhost:3011'];
const MAX_BODY_SIZE = 50 * 1024; // 50KB
const RATE_WINDOW = 60 * 1000;   // 1 min
const RATE_LIMIT = 15;           // max 15 req/min per IP
const rateMap = new Map();

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  let entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    entry = { start: now, count: 0 };
    rateMap.set(ip, entry);
  }
  entry.count++;
  // Cleanup old entries periodically
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) {
      if (now - v.start > RATE_WINDOW) rateMap.delete(k);
    }
  }
  return entry.count > RATE_LIMIT;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Rate limiting
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    console.warn(`[RATE_LIMIT] ${ip} exceeded ${RATE_LIMIT} req/min`);
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    return;
  }

  // Body size check
  const body = req.body || {};
  if (JSON.stringify(body).length > MAX_BODY_SIZE) {
    res.status(413).json({ error: '请求体过大' });
    return;
  }

  // Validate & truncate history
  if (Array.isArray(body.histSnap) && body.histSnap.length > 20) {
    body.histSnap = body.histSnap.slice(-20);
  }

  // Validate userMsg
  if (body.userMsg && (typeof body.userMsg !== 'string' || body.userMsg.length > 500)) {
    res.status(400).json({ error: '用户消息无效' });
    return;
  }

  try {
    const result = await generateGameTurn(body);
    res.status(200).json(result);
  } catch (error) {
    console.error(`[CHAT_ERROR] ip=${ip}`, error.message, error.statusCode || 500);
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.exposeMessage || '服务端调用失败'
    });
  }
};
