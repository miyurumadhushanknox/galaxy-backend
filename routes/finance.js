const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/finance - get expenditures (optionally filtered by month)
router.get('/', requireRole('owner', 'admin', 'accountant'), async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = supabase
      .from('finance_expenditures')
      .select('*')
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false });

    if (month) query = query.eq('month', month); // format: YYYY-MM
    if (year) query = query.like('month', `${year}-%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/finance/summary - revenue and profit summary
router.get('/summary', requireRole('owner', 'admin', 'accountant'), async (req, res) => {
  try {
    const { month } = req.query; // YYYY-MM

    // Get orders for the month
    let orderQuery = supabase
      .from('orders')
      .select('total, status')
      .eq('business_id', req.businessId)
      .in('status', ['delivered', 'processing', 'readytoship', 'delivering']);

    if (month) {
      orderQuery = orderQuery.like('created_at', `${month}%`);
    }

    const { data: orders } = await orderQuery;
    const revenue = orders?.reduce((sum, o) => sum + parseFloat(o.total), 0) || 0;

    // Get order items for profit calculation
    let itemQuery = supabase
      .from('order_items')
      .select('quantity, selling_price, purchase_price, orders!inner(status, created_at)')
      .eq('business_id', req.businessId)
      .in('orders.status', ['delivered', 'processing', 'readytoship', 'delivering']);

    if (month) {
      itemQuery = itemQuery.like('orders.created_at', `${month}%`);
    }

    const { data: items } = await itemQuery;
    const costOfGoods = items?.reduce((sum, i) => sum + (parseFloat(i.purchase_price) * i.quantity), 0) || 0;
    const grossProfit = revenue - costOfGoods;

    // Get expenditures
    let expQuery = supabase
      .from('finance_expenditures')
      .select('amount, type')
      .eq('business_id', req.businessId);

    if (month) expQuery = expQuery.eq('month', month);

    const { data: expenditures } = await expQuery;
    const totalExpenses = expenditures?.filter(e => e.type === 'expense').reduce((sum, e) => sum + parseFloat(e.amount), 0) || 0;
    const netProfit = grossProfit - totalExpenses;

    res.json({ revenue, costOfGoods, grossProfit, totalExpenses, netProfit });
  } catch (err) {
    console.error('Finance summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/finance - add expenditure
router.post('/', requireRole('owner', 'admin', 'accountant'), async (req, res) => {
  try {
    const { month, label, amount, type } = req.body;

    if (!month || !label || amount === undefined || !type) {
      return res.status(400).json({ error: 'month, label, amount and type are required' });
    }

    const { data, error } = await supabase
      .from('finance_expenditures')
      .insert({
        business_id: req.businessId,
        month,
        label: label.trim(),
        amount,
        type
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/finance/:id
router.put('/:id', requireRole('owner', 'admin', 'accountant'), async (req, res) => {
  try {
    const { label, amount, type } = req.body;
    const updateData = {};
    if (label) updateData.label = label.trim();
    if (amount !== undefined) updateData.amount = amount;
    if (type) updateData.type = type;

    const { data, error } = await supabase
      .from('finance_expenditures')
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

// DELETE /api/finance/:id
router.delete('/:id', requireRole('owner', 'admin', 'accountant'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('finance_expenditures')
      .delete()
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);

    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
