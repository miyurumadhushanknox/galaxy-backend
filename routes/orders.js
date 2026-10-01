const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// Helper: generate order code
async function generateOrderCode(businessId) {
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);

  const num = String((count || 0) + 1).padStart(3, '0');
  return `ORD-${num}`;
}

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status, from, to, limit = 100, offset = 0 } = req.query;

    let query = supabase
      .from('orders')
      .select(`*, order_items(*)`)
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`*, order_items(*)`)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/orders - create order
router.post('/', requireRole('owner', 'admin', 'manager', 'sales'), async (req, res) => {
  try {
    const {
      customer_name, customer_phone, customer_phone2, customer_city, customer_address, customer_email,
      delivery_method, delivery_cost, payment_method,
      discount_code, discount_amount,
      items, note
    } = req.body;

    const customerName    = customer_name;
    const customerPhone   = customer_phone;
    const customerCity    = customer_city;
    const customerAddress = customer_address;
    const deliveryMethod  = delivery_method;
    const deliveryPrice   = delivery_cost || 0;
    const paymentMethod   = payment_method;
    const discountCode    = discount_code;
    const discountAmount  = discount_amount || 0;

    if (!customerName || !items || items.length === 0) {
      return res.status(400).json({ error: 'Customer name and at least one item are required' });
    }

    // Calculate totals
    let subtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const productId = item.product_id || item.productId;
      if (!productId || !item.quantity) {
        return res.status(400).json({ error: 'Each item needs product_id and quantity' });
      }

      // Get product details (snapshot at time of order)
      const { data: product } = await supabase
        .from('products')
        .select('id, name, code, selling_price, purchase_price')
        .eq('id', productId)
        .eq('business_id', req.businessId)
        .single();

      if (!product) {
        return res.status(404).json({ error: `Product not found: ${productId}` });
      }

      const lineTotal = product.selling_price * item.quantity;
      subtotal += lineTotal;

      processedItems.push({
        productId: product.id,
        warehouseId: item.warehouse_id || null,
        productName: product.name,
        productCode: product.code,
        purchasePrice: product.purchase_price,
        sellingPrice: product.selling_price,
        quantity: item.quantity,
        lineTotal
      });
    }

    const total = subtotal + (deliveryPrice || 0) - (discountAmount || 0);
    const orderCode = await generateOrderCode(req.businessId);

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        business_id: req.businessId,
        order_code: orderCode,
        customer_name: customerName.trim(),
        customer_phone: customerPhone?.trim(),
        customer_city: customerCity?.trim(),
        customer_address: customerAddress?.trim(),
        delivery_method: deliveryMethod,
        delivery_price: deliveryPrice || 0,
        payment_method: paymentMethod,
        discount_code: discountCode,
        discount_amount: discountAmount || 0,
        subtotal,
        total,
        note: note?.trim(),
        added_by: req.user.id,
        added_by_name: `${req.user.first_name} ${req.user.last_name}`
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Create order items
    const orderItemsData = processedItems.map(item => ({
      business_id: req.businessId,
      order_id: order.id,
      product_id: item.productId,
      product_name: item.productName,
      product_code: item.productCode,
      purchase_price: item.purchasePrice,
      selling_price: item.sellingPrice,
      quantity: item.quantity,
      line_total: item.lineTotal
    }));

    await supabase.from('order_items').insert(orderItemsData);

    // Deduct stock (from first available warehouse or specified warehouse)
    for (const item of processedItems) {
      let stockQuery = supabase
        .from('stock_levels')
        .select('warehouse_id, quantity')
        .eq('product_id', item.productId)
        .eq('business_id', req.businessId)
        .gt('quantity', 0);

      if (item.warehouseId) {
        stockQuery = stockQuery.eq('warehouse_id', item.warehouseId);
      } else {
        stockQuery = stockQuery.order('quantity', { ascending: false });
      }

      const { data: stockLevels } = await stockQuery;

      let remaining = item.quantity;
      if (stockLevels) {
        for (const stock of stockLevels) {
          if (remaining <= 0) break;
          const deduct = Math.min(stock.quantity, remaining);
          await supabase.from('stock_levels').upsert({
            business_id: req.businessId,
            product_id: item.productId,
            warehouse_id: stock.warehouse_id,
            quantity: stock.quantity - deduct,
            updated_at: new Date().toISOString()
          }, { onConflict: 'product_id,warehouse_id' });

          await supabase.from('stock_history').insert({
            business_id: req.businessId,
            product_id: item.productId,
            warehouse_id: stock.warehouse_id,
            user_id: req.user.id,
            action: 'sale',
            quantity_change: -deduct,
            quantity_before: stock.quantity,
            quantity_after: stock.quantity - deduct,
            note: `Order ${orderCode}`
          });

          remaining -= deduct;
        }
      }

      // Update total sold
      try {
        const { error: rpcError } = await supabase.rpc('increment_total_sold', {
          p_product_id: item.productId,
          p_quantity: item.quantity
        });
        if (rpcError) throw rpcError;
      } catch (e) {
        // If RPC not available, update directly
        const { data: prodData } = await supabase.from('products')
          .select('total_sold')
          .eq('id', item.productId)
          .single();
        await supabase.from('products').update({
          total_sold: (prodData?.total_sold || 0) + item.quantity
        }).eq('id', item.productId);
      }
    }

    res.status(201).json(order);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/orders/:id/status - update order status
router.put('/:id/status', requireRole('owner', 'admin', 'manager', 'sales', 'delivery'), async (req, res) => {
  try {
    const { status, reason } = req.body;
    const validStatuses = ['processing', 'readytoship', 'delivering', 'delivered', 'cancelled', 'returned', 'refunded'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({
        status,
        cancel_reason: reason || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order not found' });

    res.json(data);
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
