const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/warehouses
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/warehouses
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, location } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await supabase
      .from('warehouses')
      .insert({ business_id: req.businessId, name: name.trim(), location: location?.trim() })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/warehouses/:id
router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, location, isActive, capacity } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (isActive !== undefined) updateData.is_active = isActive;
    if (capacity !== undefined) updateData.capacity = capacity;

    const { data, error } = await supabase
      .from('warehouses')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
    } catch (err) {
    console.error('PUT warehouse error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/warehouses/:id
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('warehouses')
      .delete()
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);

    if (error) throw error;
    res.json({ message: 'Warehouse deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/warehouses/stock/:productId
router.get("/stock/:productId", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("stock_levels")
      .select("warehouse_id, quantity")
      .eq("product_id", req.params.productId)
      .eq("business_id", req.businessId)
      .gt("quantity", 0)
      .order("quantity", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
