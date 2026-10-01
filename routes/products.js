const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/products - list all products with stock levels
router.get('/', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        *,
        stock_levels (
          quantity,
          warehouse_id,
          warehouses ( id, name, location )
        )
      `)
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(products);
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        stock_levels (
          quantity,
          warehouse_id,
          warehouses ( id, name, location )
        )
      `)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Product not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/products - create product
router.post('/', requireRole('owner', 'admin', 'manager', 'stockkeeper'), async (req, res) => {
  try {
    const { name, sku, selling_price, purchase_price, low_stock_threshold, stock_levels, images, description, is_active } = req.body;
    const code = sku;
    const sellingPrice = selling_price;
    const purchasePrice = purchase_price;
    const lowStockThreshold = low_stock_threshold;

    if (!name || !code || sellingPrice === undefined || purchasePrice === undefined) {
      return res.status(400).json({ error: 'Name, code, selling price and purchase price are required' });
    }

    // Check code not duplicate
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('business_id', req.businessId)
      .eq('code', code.trim().toUpperCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Product code already exists' });
    }

    // Create product
    const { data: product, error } = await supabase
      .from('products')
      .insert({
  business_id:  req.businessId,
  name:         name.trim(),
  code:         sku ? sku.trim().toUpperCase() : null,   // ← FIXED
  selling_price: selling_price,
  purchase_price: purchase_price,
  low_stock_threshold: low_stock_threshold || 5,
})
      .select()
      .single();

    if (error) throw error;

    // Add initial stock levels for each warehouse
    if (stock_levels && stock_levels.length > 0) {
      const stockInserts = stock_levels.map(sl => ({
        business_id: req.businessId,
        product_id: product.id,
        warehouse_id: sl.warehouse_id,
        quantity: parseInt(sl.quantity) || 0
      }));
      await supabase.from('stock_levels').insert(stockInserts);
    }

    res.status(201).json(product);
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/products/:id - update product
router.put('/:id', requireRole('owner', 'admin', 'manager', 'stockkeeper'), async (req, res) => {
  try {
    const { name, sellingPrice, purchasePrice, lowStockThreshold, isActive } = req.body;

    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name.trim();
    if (sellingPrice !== undefined) updateData.selling_price = sellingPrice;
    if (purchasePrice !== undefined) updateData.purchase_price = purchasePrice;
    if (lowStockThreshold !== undefined) updateData.low_stock_threshold = lowStockThreshold;
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product not found' });

    res.json(data);
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/products/:id/stock - update stock for a specific warehouse
router.put('/:id/stock', requireRole('owner', 'admin', 'manager', 'stockkeeper'), async (req, res) => {
  try {
    const { warehouseId, quantity, action, note } = req.body;

    if (!warehouseId || quantity === undefined || !action) {
      return res.status(400).json({ error: 'warehouseId, quantity and action are required' });
    }

    // Get current stock
    const { data: current } = await supabase
      .from('stock_levels')
      .select('quantity')
      .eq('product_id', req.params.id)
      .eq('warehouse_id', warehouseId)
      .single();

    const currentQty = current ? current.quantity : 0;
    let newQty;

    if (action === 'set') {
      newQty = parseInt(quantity);
    } else if (action === 'add') {
      newQty = currentQty + parseInt(quantity);
    } else if (action === 'remove') {
      newQty = currentQty - parseInt(quantity);
      if (newQty < 0) return res.status(400).json({ error: 'Insufficient stock' });
    } else {
      return res.status(400).json({ error: 'Invalid action. Use: set, add, remove' });
    }

    // Upsert stock level
    const { error: stockError } = await supabase
      .from('stock_levels')
      .upsert({
        business_id: req.businessId,
        product_id: req.params.id,
        warehouse_id: warehouseId,
        quantity: newQty,
        updated_at: new Date().toISOString()
      }, { onConflict: 'product_id,warehouse_id' });

    if (stockError) throw stockError;

    // Log stock history
    await supabase.from('stock_history').insert({
      business_id: req.businessId,
      product_id: req.params.id,
      warehouse_id: warehouseId,
      user_id: req.user.id,
      action: action === 'set' ? 'adjust' : action,
      quantity_change: newQty - currentQty,
      quantity_before: currentQty,
      quantity_after: newQty,
      note: note || null
    });

    res.json({ message: 'Stock updated', newQuantity: newQty });
  } catch (err) {
    console.error('Update stock error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/products/transfer - transfer stock between warehouses
router.post('/transfer', requireRole('owner', 'admin', 'manager', 'stockkeeper'), async (req, res) => {
  try {
    const { productId, fromWarehouseId, toWarehouseId, quantity, note } = req.body;

    if (!productId || !fromWarehouseId || !toWarehouseId || !quantity) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (fromWarehouseId === toWarehouseId) {
      return res.status(400).json({ error: 'Cannot transfer to the same warehouse' });
    }

    const qty = parseInt(quantity);

    // Get source stock
    const { data: fromStock } = await supabase
      .from('stock_levels')
      .select('quantity')
      .eq('product_id', productId)
      .eq('warehouse_id', fromWarehouseId)
      .single();

    if (!fromStock || fromStock.quantity < qty) {
      return res.status(400).json({ error: 'Insufficient stock in source warehouse' });
    }

    const { data: toStock } = await supabase
      .from('stock_levels')
      .select('quantity')
      .eq('product_id', productId)
      .eq('warehouse_id', toWarehouseId)
      .single();

    const toQty = toStock ? toStock.quantity : 0;

    // Deduct from source
    await supabase.from('stock_levels').upsert({
      business_id: req.businessId,
      product_id: productId,
      warehouse_id: fromWarehouseId,
      quantity: fromStock.quantity - qty,
      updated_at: new Date().toISOString()
    }, { onConflict: 'product_id,warehouse_id' });

    // Add to destination
    await supabase.from('stock_levels').upsert({
      business_id: req.businessId,
      product_id: productId,
      warehouse_id: toWarehouseId,
      quantity: toQty + qty,
      updated_at: new Date().toISOString()
    }, { onConflict: 'product_id,warehouse_id' });

    // Log transfer
    await supabase.from('stock_transfers').insert({
      business_id: req.businessId,
      product_id: productId,
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      quantity: qty,
      transferred_by: req.user.id,
      note: note || null
    });

    // Log stock history for both warehouses
    await supabase.from('stock_history').insert([
      {
        business_id: req.businessId,
        product_id: productId,
        warehouse_id: fromWarehouseId,
        user_id: req.user.id,
        action: 'transfer',
        quantity_change: -qty,
        quantity_before: fromStock.quantity,
        quantity_after: fromStock.quantity - qty,
        note: `Transfer to warehouse`
      },
      {
        business_id: req.businessId,
        product_id: productId,
        warehouse_id: toWarehouseId,
        user_id: req.user.id,
        action: 'transfer',
        quantity_change: qty,
        quantity_before: toQty,
        quantity_after: toQty + qty,
        note: `Transfer from warehouse`
      }
    ]);

    res.json({ message: 'Transfer complete' });
  } catch (err) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/:id/history - stock history
router.get('/:id/history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stock_history')
      .select(`*, warehouses(name), users(first_name, last_name)`)
      .eq('product_id', req.params.id)
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);

    if (error) throw error;
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
