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

    if (!business) {
    return res.status(403).json({ error: 'Business not found.' });
    }
    if (business.is_blocked) {
    return res.status(403).json({ error: 'Account is blocked. Contact KNOX support.', isBlocked: true, business });
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
          },
        business: {
        id: business.id,
        name: business.name,
        plan: business.plan,
        trialEndsAt: business.trial_ends_at,
        trialStartsAt: business.trial_starts_at,
        knoxStartDate: business.knox_start_date,
        category: business.category,
        address: business.address
       }
  });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
// GET /api/auth/me - check current session business status
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id, name, plan, is_blocked, is_active, trial_ends_at, knox_start_date, next_due_date, knox_sub_payments, knox_plan_amount, setup_paid')
      .eq('id', req.user.businessId)
      .single();
    if (error || !business) return res.status(404).json({ error: 'Business not found', debug: error?.message, businessId: req.user.businessId });
    if (business.is_blocked) { return res.json({ business, isBlocked: true }); }

// Calculate next renewal date
var nextDueDate = null;
if (business.knox_start_date) {
  var start = new Date(business.knox_start_date);
  var isYearly = business.plan && business.plan.indexOf('yearly') !== -1;
  var now = new Date();
  var candidate;
  if (isYearly) {
    candidate = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
    while (candidate <= now) candidate = new Date(candidate.getFullYear() + 1, candidate.getMonth(), candidate.getDate());
  } else {
    candidate = new Date(now.getFullYear(), now.getMonth(), start.getDate());
    if (candidate <= now) candidate = new Date(now.getFullYear(), now.getMonth() + 1, start.getDate());
  }
  var mm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  nextDueDate = candidate.getDate() + ' ' + mm[candidate.getMonth()] + ' ' + candidate.getFullYear();
  // Save to Supabase
  var isoStr = candidate.getFullYear()+'-'+String(candidate.getMonth()+1).padStart(2,'0')+'-'+String(candidate.getDate()).padStart(2,'0');
  await supabase.from('businesses').update({ next_due_date: isoStr }).eq('id', business.id);
}

res.json({ business, knoxStartDate: business.knox_start_date, nextDueDate });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
