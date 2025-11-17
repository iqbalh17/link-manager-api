require('dotenv').config();
const express = require('express');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./authMiddleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.status(200).json({
      message: 'Database connection successful!',
      time: result.rows[0].now,
    });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});


/**
 * @route   POST /auth/register
 * @desc    Mendaftarkan user baru
 * @access  Public
 */
 
app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, dan password diperlukan' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const newUserQuery = `
      INSERT INTO Users (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at
    `;
    const result = await db.query(newUserQuery, [username, email, password_hash]);

    res.status(201).json({
      message: 'User berhasil dibuat',
      user: result.rows[0],
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username atau email sudah ada' });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});


/**
 * @route   POST /auth/login
 * @desc    Login user dan dapatkan token
 * @access  Public
 */
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password diperlukan' });
  }

  try {
    const userQuery = 'SELECT * FROM Users WHERE email = $1';
    const result = await db.query(userQuery, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Kredensial salah' }); // Pesan error generik
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      // Password salah
      return res.status(401).json({ error: 'Kredensial salah' });
    }

    const payload = {
      userId: user.id,
      username: user.username,
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET, 
      { expiresIn: '1d' } 
    );

    res.status(200).json({
      message: 'Login berhasil',
      token: token,
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/**
 * @route   POST /api/v1/links
 * @desc    Membuat link baru
 * @access  Private
 */
app.post('/api/v1/links', authMiddleware, async (req, res) => {
  const { title, url, "order": linkOrder } = req.body;
  const { userId } = req.user; 

  // Validasi input
  if (!title || !url) {
    return res.status(400).json({ error: 'Title dan URL diperlukan' });
  }

  try {
    const newLinkQuery = `
      INSERT INTO Links (user_id, title, url, "order")
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const result = await db.query(newLinkQuery, [userId, title, url, linkOrder || 0]);

    res.status(201).json({
      message: 'Link berhasil dibuat',
      link: result.rows[0],
    });
  } catch (err) {
    console.error('Create link error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/**
 * @route   GET /api/v1/links
 * @desc    Mendapatkan semua link milik user yang sedang login
 * @access  Private
 */
app.get('/api/v1/links', authMiddleware, async (req, res) => {
  const { userId } = req.user;

  try {
    const getLinksQuery = `
      SELECT * FROM Links 
      WHERE user_id = $1 
      ORDER BY "order" ASC, created_at ASC
    `;
    
    const result = await db.query(getLinksQuery, [userId]);

    res.status(200).json(result.rows); // Kirim array of links
  } catch (err) {
    console.error('Get links error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/**
 * @route   PUT /api/v1/links/:linkId
 * @desc    Memperbarui link
 * @access  Private
 */
app.put('/api/v1/links/:linkId', authMiddleware, async (req, res) => {
  const { linkId } = req.params; // Ambil ID link dari URL
  const { title, url, "order": linkOrder } = req.body;
  const { userId } = req.user;

  if (!title && !url && linkOrder === undefined) {
    return res.status(400).json({ error: 'Perlu setidaknya satu field untuk di-update (title, url, or order)' });
  }


  try {
    const checkQuery = 'SELECT * FROM Links WHERE id = $1 AND user_id = $2';
    const checkResult = await db.query(checkQuery, [linkId, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Link tidak ditemukan atau Anda bukan pemiliknya' });
    }

    const existingLink = checkResult.rows[0];

    const newTitle = title || existingLink.title;
    const newUrl = url || existingLink.url;
    const newOrder = (linkOrder !== undefined) ? linkOrder : existingLink.order; 

    const updateQuery = `
      UPDATE Links
      SET title = $1, url = $2, "order" = $3
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `;
    const updateResult = await db.query(updateQuery, [newTitle, newUrl, newOrder, linkId, userId]);

    res.status(200).json({
      message: 'Link berhasil diperbarui',
      link: updateResult.rows[0],
    });
  } catch (err) {
    console.error('Update link error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});


/**
 * @route   DELETE /api/v1/links/:linkId
 * @desc    Menghapus sebuah link
 * @access  Private
 */
app.delete('/api/v1/links/:linkId', authMiddleware, async (req, res) => {
  const { linkId } = req.params;
  const { userId } = req.user;

  try {
    const deleteQuery = `
      DELETE FROM Links
      WHERE id = $1 AND user_id = $2
      RETURNING id 
    `;
    
    const result = await db.query(deleteQuery, [linkId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link tidak ditemukan atau Anda bukan pemiliknya' });
    }

    res.status(200).json({ message: 'Link berhasil dihapus' });
  } catch (err) {
    console.error('Delete link error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/**
 * @route   GET /click/:linkId
 * @desc    Melacak klik dan me-redirect ke URL asli
 * @access  Public
 */
app.get('/click/:linkId', async (req, res) => {
  const { linkId } = req.params;

  try {
    const updateQuery = `
      UPDATE Links
      SET click_count = click_count + 1
      WHERE id = $1
      RETURNING url 
    `;
    
    const result = await db.query(updateQuery, [linkId]);

    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link tidak ditemukan' });
    }

    const originalUrl = result.rows[0].url;

    res.redirect(301, originalUrl);

  } catch (err) {
    console.error('Click tracking error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});


/**
 * @route   GET /:username
 * @desc    Mendapatkan profil publik dan link milik user
 * @access  Public
 */
app.get('/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const userQuery = 'SELECT id, username, profile_picture_url FROM Users WHERE username = $1';
    const userResult = await db.query(userQuery, [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }

    const user = userResult.rows[0];

   
    const linksQuery = `
      SELECT id, title, url, "order", click_count 
      FROM Links 
      WHERE user_id = $1 
      ORDER BY "order" ASC, created_at ASC
    `;
    const linksResult = await db.query(linksQuery, [user.id]);

    res.status(200).json({
      username: user.username,
      profile_picture_url: user.profile_picture_url || null,
      links: linksResult.rows,
    });

  } catch (err) {
    console.error('Get public profile error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});


app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});