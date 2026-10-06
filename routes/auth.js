const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    // Find user by username OR email (globally)
    const loginValue = login.toLowerCase().trim();
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.eq.${loginValue},email.eq.${loginValue}`)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.status) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact your admin.' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Check business status
    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', user.business_id)
      .single();

    if (!business || business.is_blocked) {
      return res.status(403).json({ error: 'Account is blocked. Contact KNOX support.' });
    }

    if (business.plan === 'trial') {
      const trialEnd = new Date(business.trial_ends_at);
      if (trialEnd < new Date()) {
        return res.status(403).json({ error: 'Trial expired. Please upgrade your plan.' });
      }
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, businessId: user.business_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        businessId: user.business_id
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
