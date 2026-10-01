/**
 * KNOX Admin Routes
 * Used by the KNOX Client Manager dashboard — protected by KNOX_ADMIN_KEY header
 * All routes: /api/knox-admin/...
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

// Middleware: verify KNOX admin key
function requireKnoxKey(req, res, next) {
  const key = req.headers['x-knox-admin-key'];
  if (!key || key !== process.env.KNOX_ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
router.use(requireKnoxKey);

// ═══════════════════════════════════════════════════
// GET /api/knox-admin/ping — quick connectivity test
// ═══════════════════════════════════════════════════
router.get('/ping', async (req, res) => {
  try {
    // Test DB connection by querying businesses table columns
    const { data, error } = await supabase
      .from('businesses')
      .select('id, knox_contact, knox_start_date, knox_setup_paid')
      .limit(1);

    if (error) {
      return res.json({
        ok: false,
        backend: true,
        db: false,
        error: error.message,
        hint: 'Run knox-admin-migration.sql in Supabase SQL Editor — the knox_* columns are missing.'
      });
    }

    res.json({ ok: true, backend: true, db: true, message: 'All good!' });
  } catch (err) {
    res.json({ ok: false, backend: true, db: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/knox-admin/clients — list all businesses
// ═══════════════════════════════════════════════════
router.get('/clients', async (req, res) => {
  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, name, phone, owner_email, plan, is_active, is_blocked, trial_ends_at, created_at, knox_notes, knox_setup_method, knox_setup_paid, knox_sub_payments, knox_sub_amounts, knox_contact, knox_start_date')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ clients: businesses || [] });
  } catch (err) {
    console.error('Knox list clients error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/knox-admin/clients — register new business (client)
// ═══════════════════════════════════════════════════
router.post('/clients', async (req, res) => {
  try {
    const {
      businessName, contact, phone, email,
      plan, start, setupMethod, trial, notes,
      ownerUsername, ownerPassword
    } = req.body;

    if (!businessName || !phone || !ownerUsername || !ownerPassword) {
      return res.status(400).json({ error: 'businessName, phone, ownerUsername and ownerPassword are required' });
    }

    // Create business
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .insert({
        name: businessName.trim(),
        phone: phone.trim(),
        owner_email: email ? email.toLowerCase().trim() : null,
        plan: plan || 'monthly2k',
        is_active: true,
        is_blocked: false,
        trial_ends_at: trial ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null,
        knox_contact: contact || '',
        knox_start_date: start || new Date().toISOString().slice(0, 10),
        knox_setup_method: setupMethod || 'full',
        knox_setup_paid: [false, false, false, false],
        knox_sub_payments: {},
        knox_sub_amounts: {},
        knox_notes: notes || ''
      })
      .select()
      .single();

    if (bizError) throw bizError;

    // Create owner user
    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    const { error: userError } = await supabase
      .from('users')
      .insert({
        business_id: business.id,
        first_name: businessName.trim(),
        last_name: '',
        username: ownerUsername.toLowerCase().trim(),
        password_hash: passwordHash,
        role: 'owner',
        status: true
      });

    if (userError) throw userError;

    // Default settings
    await supabase.from('business_settings').insert({ business_id: business.id });
    await supabase.from('delivery_methods').insert([
      { business_id: business.id, name: 'No Delivery', price: 0, sort_order: 0 },
      { business_id: business.id, name: 'Koombiyo', price: 400, sort_order: 1 }
    ]);
    await supabase.from('payment_methods').insert([
      { business_id: business.id, name: 'Cash', sort_order: 0 },
      { business_id: business.id, name: 'Bank Transfer', sort_order: 1 }
    ]);

    res.status(201).json({ client: business });
  } catch (err) {
    console.error('Knox create client error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ═══════════════════════════════════════════════════
// PUT /api/knox-admin/clients/:id — update client details / billing
// ═══════════════════════════════════════════════════
router.put('/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    const allowed = [
      'name', 'phone', 'owner_email', 'plan', 'is_active', 'is_blocked',
      'trial_ends_at', 'knox_contact', 'knox_start_date', 'knox_setup_method',
      'knox_setup_paid', 'knox_sub_payments', 'knox_sub_amounts', 'knox_notes'
    ];

    // Map incoming camelCase to DB columns
    const fieldMap = {
      businessName: 'name', phone: 'phone', email: 'owner_email',
      plan: 'plan', isActive: 'is_active', isBlocked: 'is_blocked',
      trialEndsAt: 'trial_ends_at', contact: 'knox_contact',
      start: 'knox_start_date', setupMethod: 'knox_setup_method',
      setupPaid: 'knox_setup_paid', subPayments: 'knox_sub_payments',
      subAmounts: 'knox_sub_amounts', notes: 'knox_notes'
    };

    Object.entries(req.body).forEach(([key, val]) => {
      const col = fieldMap[key] || key;
      if (allowed.includes(col)) updates[col] = val;
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ client: data });
  } catch (err) {
    console.error('Knox update client error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/knox-admin/stats — dashboard summary stats
// ═══════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, plan, is_active, is_blocked, trial_ends_at, knox_setup_paid, knox_sub_payments, knox_sub_amounts, knox_start_date, knox_setup_method, created_at');

    if (error) throw error;

    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);

    let totalClients = businesses.length;
    let activeClients = 0, trialClients = 0, blockedClients = 0;
    let collectedThisMonth = 0, totalOutstanding = 0;

    const PLAN_AMOUNTS = {
      monthly2k: 2000, monthly5k: 5000,
      yearly2k: 20000, yearly5k: 50000,
      unlimited: null
    };
    const SETUP_FEES = {
      monthly2k: 20000, monthly5k: 20000,
      yearly2k: 40000, yearly5k: 70000,
      unlimited: 20000
    };

    businesses.forEach(b => {
      const isTrial = b.trial_ends_at && new Date(b.trial_ends_at) > now && !b.is_blocked;
      const isBlocked = b.is_blocked;
      const isActive = b.is_active && !isBlocked && !isTrial;

      if (isBlocked) blockedClients++;
      else if (isTrial) trialClients++;
      else if (isActive) activeClients++;

      const planAmt = PLAN_AMOUNTS[b.plan];
      const setupFee = SETUP_FEES[b.plan] || 20000;
      const setupPaid = b.knox_setup_paid || [false, false, false, false];
      const subPayments = b.knox_sub_payments || {};
      const subAmounts = b.knox_sub_amounts || {};

      // Outstanding setup
      const unpaidInstall = setupPaid.filter(p => !p).length;
      totalOutstanding += (setupFee / 4) * unpaidInstall;

      // This month subscription
      if (planAmt && subPayments[thisMonth]) collectedThisMonth += planAmt;
      // Outstanding subscription (unpaid months)
      Object.keys(subPayments).forEach(key => {
        if (!subPayments[key]) {
          totalOutstanding += subAmounts[key] || planAmt || 0;
        }
      });
    });

    res.json({
      totalClients, activeClients, trialClients, blockedClients,
      collectedThisMonth, totalOutstanding
    });
  } catch (err) {
    console.error('Knox stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/knox-admin/announcements — get current announcements & notifications
// ═══════════════════════════════════════════════════
router.get('/announcements', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('knox_announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      announcements: data?.images || [null, null, null, null, null],
      notifications: data?.notifications || []
    });
  } catch (err) {
    res.json({ announcements: [null, null, null, null, null], notifications: [] });
  }
});

// ═══════════════════════════════════════════════════
// PUT /api/knox-admin/announcements — save announcements & notifications
// ═══════════════════════════════════════════════════
router.put('/announcements', async (req, res) => {
  try {
    const { announcements, notifications } = req.body;

    // Upsert into a single-row table
    const { error } = await supabase
      .from('knox_announcements')
      .upsert({ id: 1, images: announcements, notifications, updated_at: new Date().toISOString() });

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Knox save announcements error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
