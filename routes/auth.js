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

    }

    // Find user by username within this business
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('business_id', businessId)
      .eq('username', username.toLowerCase().trim())
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
      .eq('id', businessId)
      .single();

    if (!business || business.is_blocked) {
      return res.status(403).json({ error: 'Account is blocked. Contact KNOX support.' });
    }

    if (business.plan === 'trial') {
      const trialEnd = new Date(business.trial_ends_at);
      if (new Date() > trialEnd) {
        return res.status(403).json({ error: 'Trial period ended. Please upgrade.' });
      }
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Generate JWT token (expires in 8 hours)
    const token = jwt.sign(
      { userId: user.id, businessId: user.business_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        role: user.role,
        businessId: user.business_id
      },
      business: {
        id: business.id,
        name: business.name,
        plan: business.plan,
        trialEndsAt: business.trial_ends_at
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me - get current user info
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('id, name, plan, trial_ends_at, logo_url')
      .eq('id', req.businessId)
      .single();

    res.json({
      user: req.user,
      business
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await supabase
      .from('users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
