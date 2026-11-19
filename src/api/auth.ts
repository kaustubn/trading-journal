import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import pool from '../db';
import { generateToken, verifyToken } from '../middleware/auth';
import { passwordProblem } from '../security/password';
import { createLoginLimiter } from '../security/loginLimiter';

const router = Router();

// Brute-force protection: failed logins are counted per IP and per IP+email (15-minute window).
const WINDOW = 15 * 60 * 1000;
const perIp = createLoginLimiter({ maxFailures: 20, windowMs: WINDOW });
const perIpEmail = createLoginLimiter({ maxFailures: 5, windowMs: WINDOW });
// Sign-ups: at most 5 new accounts per IP per hour.
const signups = createLoginLimiter({ maxFailures: 5, windowMs: 60 * 60 * 1000 });
// Compared against when the email is unknown, so both cases take the same time (no email probing by timing).
const DUMMY_HASH = bcryptjs.hashSync('not-a-real-password-' + Math.random(), 10);

function normEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null;
  const s = e.trim().toLowerCase();
  return s.length >= 3 && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || 'unknown';
    const gate = signups.check(ip);
    if (!gate.allowed) {
      res.set('Retry-After', String(gate.retryAfterSec));
      return res.status(429).json({ error: 'Too many sign-ups from this network. Try again later.' });
    }
    const email = normEmail(req.body?.email);
    const password = req.body?.password;
    if (!email) return res.status(400).json({ error: 'Valid email required' });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    signups.fail(ip); // counts attempts, not failures

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hashedPassword]
    );

    const user = result.rows[0];
    const token = generateToken(user.id);

    res.json({ user, token });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || password.length > 200) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const ip = req.ip || 'unknown';
    const keyIp = 'ip:' + ip;
    const keyPair = 'pair:' + ip + '|' + email.trim().toLowerCase();
    const a = perIp.check(keyIp), b = perIpEmail.check(keyPair);
    if (!a.allowed || !b.allowed) {
      const wait = Math.max(a.retryAfterSec, b.retryAfterSec);
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: `Too many failed logins. Try again in ${Math.ceil(wait / 60)} min.` });
    }

    // Emails are matched case-insensitively (older accounts may have been saved with capitals)
    const result = await pool.query(
      'SELECT id, email, password FROM users WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1',
      [email.trim()]
    );

    const user = result.rows[0];
    const passwordMatch = await bcryptjs.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !passwordMatch) {
      perIp.fail(keyIp); perIpEmail.fail(keyPair);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    perIpEmail.success(keyPair);

    const token = generateToken(user.id);
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', verifyToken, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT id, email, created_at, COALESCE(plan,'free') AS plan, (role = 'admin') AS is_admin FROM users WHERE id = $1",
      [req.userId]
    );
    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
