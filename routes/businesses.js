const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

// POST /api/businesses/register - register a new business (called by KNOX admin)
// This endpoint uses a special KNOX admin key, not a user JWT
router.post('/register', async (req, res) => {
  try {
    const knoxKey = req.headers['x-knox-admin-key'];
    if (knoxKey !== process.env.KNOX_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      businessName, businessCategory, businessAddress, businessPhone,
      ownerEmail, ownerFirstName, ownerLastName, ownerUsername, ownerPassword,
      plan
    } = req.body;

    if (!businessName || !ownerEmail || !ownerFirstName || !ownerLastName || !ownerUsername || !ownerPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check email not taken
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_email', ownerEmail.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create business
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .insert({
        name: businessName.trim(),
        category: businessCategory,
        address: businessAddress,
        phone: businessPhone,
        owner_email: ownerEmail.toLowerCase().trim(),
        plan: plan || 'trial'
      })
      .select()
      .single();

    if (bizError) throw bizError;

    // Create owner user
    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        business_id: business.id,
        first_name: ownerFirstName.trim(),
        last_name: ownerLastName.trim(),
        username: ownerUsername.toLowerCase().trim(),
        password_hash: passwordHash,
        role: 'owner',
        status: true
      })
      .select('id, first_name, last_name, username, role')
      .single();

    if (userError) throw userError;

    // Create default settings
    await supabase.from('business_settings').insert({
      business_id: business.id
    });

    // Create default delivery methods
    await supabase.from('delivery_methods').insert([
      { business_id: business.id, name: 'No Delivery', price: 0, sort_order: 0 },
      { business_id: business.id, name: 'Koombiyo', price: 400, sort_order: 1 }
    ]);

    // Create default payment methods
    await supabase.from('payment_methods').insert([
      { business_id: business.id, name: 'Cash', sort_order: 0 },
      { business_id: business.id, name: 'Bank Transfer', sort_order: 1 }
    ]);

    res.status(201).json({
      business: { id: business.id, name: business.name, plan: business.plan },
      owner: user,
      message: 'Business registered successfully'
    });

  } catch (err) {
    console.error('Register business error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/businesses/check/:businessId - check if business ID is valid (for login page)
router.get('/check/:businessId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, is_active, is_blocked, plan, trial_ends_at')
      .eq('id', req.params.businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json({
      id: data.id,
      name: data.name,
      isActive: data.is_active,
      isBlocked: data.is_blocked,
      plan: data.plan,
      trialEndsAt: data.trial_ends_at
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
