const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const [settingsRes, bizRes, deliveryRes, paymentRes, discountRes] = await Promise.all([
      supabase.from('business_settings').select('*').eq('business_id', req.businessId).single(),
      supabase.from('businesses').select('name, category, address, phone, logo_url').eq('id', req.businessId).single(),
      supabase.from('delivery_methods').select('*').eq('business_id', req.businessId).order('sort_order'),
      supabase.from('payment_methods').select('*').eq('business_id', req.businessId).order('sort_order'),
      supabase.from('discount_codes').select('*').eq('business_id', req.businessId)
    ]);

    res.json({
      settings: settingsRes.data,
      business: bizRes.data,
      deliveryMethods: deliveryRes.data || [],
      paymentMethods: paymentRes.data || [],
      discountCodes: discountRes.data || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/general
router.put('/general', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { timezone, dateFormat, timeFormat, currency, theme, lowStockThreshold,
            emailAlerts, orderAlerts, orderStatusAlerts, userAddAlerts, productAddAlerts } = req.body;

    const { data, error } = await supabase
      .from('business_settings')
      .upsert({
        business_id: req.businessId,
        timezone, date_format: dateFormat, time_format: timeFormat,
        currency, theme, low_stock_threshold: lowStockThreshold,
        email_alerts: emailAlerts, order_alerts: orderAlerts,
        order_status_alerts: orderStatusAlerts, user_add_alerts: userAddAlerts,
        product_add_alerts: productAddAlerts,
        updated_at: new Date().toISOString()
      }, { onConflict: 'business_id' })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/business
router.put('/business', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, category, address, phone } = req.body;
    const updateData = { updated_at: new Date().toISOString() };
    if (name) updateData.name = name.trim();
    if (category !== undefined) updateData.category = category;
    if (address !== undefined) updateData.address = address.trim();
    if (phone !== undefined) updateData.phone = phone.trim();

    const { data, error } = await supabase
      .from('businesses')
      .update(updateData)
      .eq('id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/delivery-methods
router.post('/delivery-methods', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await supabase
      .from('delivery_methods')
      .insert({ business_id: req.businessId, name: name.trim(), price: price || 0 })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/delivery-methods/:id
router.put('/delivery-methods/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, price, isActive } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (price !== undefined) updateData.price = price;
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data, error } = await supabase
      .from('delivery_methods')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/settings/delivery-methods/:id
router.delete('/delivery-methods/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    await supabase.from('delivery_methods').delete().eq('id', req.params.id).eq('business_id', req.businessId);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/payment-methods
router.post('/payment-methods', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await supabase
      .from('payment_methods')
      .insert({ business_id: req.businessId, name: name.trim() })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/settings/payment-methods/:id
router.delete('/payment-methods/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    await supabase.from('payment_methods').delete().eq('id', req.params.id).eq('business_id', req.businessId);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/discount-codes
router.post('/discount-codes', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { code, type, value } = req.body;
    if (!code || !type || value === undefined) {
      return res.status(400).json({ error: 'code, type and value required' });
    }

    const { data, error } = await supabase
      .from('discount_codes')
      .insert({ business_id: req.businessId, code: code.trim().toUpperCase(), type, value })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/settings/discount-codes/:id
router.delete('/discount-codes/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    await supabase.from('discount_codes').delete().eq('id', req.params.id).eq('business_id', req.businessId);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
