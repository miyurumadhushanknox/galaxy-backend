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

    // Auto-seed system payment methods if missing
    const existingTypes = (paymentRes.data || []).map(p => p.type);
    const systemTypes = [
      { name: 'Cash', type: 'cash', sort_order: 1 },
      { name: 'Card', type: 'card', sort_order: 2 },
      { name: 'Cash on Delivery', type: 'cod', sort_order: 3 },
      { name: 'Bank Deposit', type: 'bank_deposit', sort_order: 4 },
      { name: 'Koko Pay', type: 'koko_pay', sort_order: 5 },
      { name: 'Mint Pay', type: 'mint_pay', sort_order: 6 },
    ];
    const missing = systemTypes.filter(t => !existingTypes.includes(t.type));
    if (missing.length > 0) {
      await supabase.from('payment_methods').insert(
        missing.map(t => ({ business_id: req.businessId, name: t.name, type: t.type, is_active: false, sort_order: t.sort_order, service_charge: 0, absorb_cost: false, config: {} }))
      );
      const { data: refreshed } = await supabase.from('payment_methods').select('*').eq('business_id', req.businessId).order('sort_order');
      paymentRes.data = refreshed;
    }

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
    const { name, price, apiKey, manualPrice, pricingMode, provincePrices, districtPrices } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await supabase
      .from('delivery_methods')
      .insert({ business_id: req.businessId, name: name.trim(), price: price || 0, api_key: apiKey||null, manual_price: manualPrice||false, pricing_mode: pricingMode||'province', province_prices: provincePrices||{}, district_prices: districtPrices||{} })
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
    const { name, price, isActive, apiKey, manualPrice, pricingMode, provincePrices, districtPrices } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (price !== undefined) updateData.price = price;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (apiKey !== undefined) updateData.api_key = apiKey;
    if (manualPrice !== undefined) updateData.manual_price = manualPrice;
    if (pricingMode !== undefined) updateData.pricing_mode = pricingMode;
    if (provincePrices !== undefined) updateData.province_prices = provincePrices;
    if (districtPrices !== undefined) updateData.district_prices = districtPrices;

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
    const { name, serviceCharge, absorbCost } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await supabase
      .from('payment_methods')
      .insert({ business_id: req.businessId, name: name.trim(), service_charge: serviceCharge||0, pay_by_customer: payByCustomer||false })
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

// PUT /api/settings/payment-methods/:id
router.put('/payment-methods/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, serviceCharge, payByCustomer, isActive, config } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (serviceCharge !== undefined) updateData.service_charge = serviceCharge;
    if (payByCustomer !== undefined) updateData.pay_by_customer = payByCustomer;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (config !== undefined) updateData.config = config;
    const { data, error } = await supabase.from('payment_methods').update(updateData).eq('id', req.params.id).eq('business_id', req.businessId).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/discount-codes
router.post('/discount-codes', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { code, type, value, name, productIds } = req.body;
    if (!code || !type || value === undefined || !name) {
      return res.status(400).json({ error: 'code, type and value required' });
    }

    const { data, error } = await supabase
      .from('discount_codes')
      .insert({ business_id: req.businessId, code: code.trim().toUpperCase(), type, value, name, product_ids: productIds||[] })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/discount-codes/:id
router.put('/discount-codes/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { active, name, code, type, value } = req.body;
    const updateData = {};
       if (active !== undefined) updateData.is_active = active;
       if (name !== undefined) updateData.name = name;
       if (code !== undefined) updateData.code = code;
       if (type !== undefined) updateData.type = type;
       if (value !== undefined) updateData.value = value;
    const { data, error } = await supabase
      .from('discount_codes')
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
