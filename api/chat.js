'use strict';

const { generateGameTurn } = require('../lib/chat');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const result = await generateGameTurn(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.exposeMessage || '服务端调用失败'
    });
  }
};
