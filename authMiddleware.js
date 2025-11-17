const jwt = require('jsonwebtoken');
require('dotenv').config();


function authMiddleware(req, res, next) {
  const authHeader = req.header('Authorization');

  if (!authHeader) {
    return res.status(401).json({ error: 'Akses ditolak. Tidak ada token.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Format token salah. Harus "Bearer <token>".' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch (err) {
    res.status(401).json({ error: 'Token tidak valid atau kadaluwarsa.' });
  }
}

module.exports = authMiddleware;