const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Verify JWT token on every protected route
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Verify user still exists and is active
    const { data: user, error } = await supabase
      .from('users')
      .select('id, business_id, role, status, first_name, last_name, username')
      .eq('id', decoded.userId)
      .eq('business_id', decoded.businessId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.status) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    // Check if business is active and not blocked
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id, is_active, is_blocked, trial_ends_at, plan')
      .eq('id', decoded.businessId)
      .single();

    if (bizError || !business) {
      return res.status(401).json({ error: 'Business not found' });
    }

    if (business.is_blocked) {
      return res.status(403).json({ error: 'Account is blocked. Please contact KNOX support.' });
    }

    if (!business.is_active) {
      return res.status(403).json({ error: 'Account is inactive.' });
    }

    // Check trial expiry
    if (business.plan === 'trial') {
      const trialEnd = new Date(business.trial_ends_at);
      if (new Date() > trialEnd) {
        return res.status(403).json({ error: 'Trial period has ended. Please upgrade your plan.' });
      }
    }

    // Attach user and business info to request
    req.user = user;
    req.businessId = decoded.businessId;

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Permission check helper
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
};

module.exports = { authMiddleware, requireRole };
