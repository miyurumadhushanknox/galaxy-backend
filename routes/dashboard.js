const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/dashboard - main dashboard stats
router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    const [
      totalProductsRes,
      todayOrdersRes,
      monthOrdersRes,
      lowStockRes,
      recentOrdersRes,
      alertsRes
    ] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('business_id', req.businessId).eq('is_active', true),
      supabase.from('orders').select('total, status').eq('business_id', req.businessId).gte('created_at', startOfDay),
      supabase.from('orders').select('total, status').eq('business_id', req.businessId).gte('created_at', startOfMonth),
      supabase.from('stock_levels').select('quantity, products(name, code, low_stock_threshold)').eq('business_id', req.businessId),
      supabase.from('orders').select('*, order_items(*)').eq('business_id', req.businessId).order('created_at', { ascending: false }).limit(10),
      supabase.from('alerts').select('*').eq('business_id', req.businessId).eq('is_read', false).order('created_at', { ascending: false }).limit(20)
    ]);

    // Calculate today's sales
    const todayOrders = todayOrdersRes.data || [];
    const todaySales = todayOrders
      .filter(o => !['cancelled', 'refunded'].includes(o.status))
      .reduce((sum, o) => sum + parseFloat(o.total), 0);

    // Calculate month sales
    const monthOrders = monthOrdersRes.data || [];
    const monthSales = monthOrders
      .filter(o => !['cancelled', 'refunded'].includes(o.status))
      .reduce((sum, o) => sum + parseFloat(o.total), 0);

    // Find low stock items
    const stockData = lowStockRes.data || [];
    const lowStockItems = [];
    const stockByProduct = {};

    for (const sl of stockData) {
      if (!sl.products) continue;
      const pid = sl.products.code;
      if (!stockByProduct[pid]) {
        stockByProduct[pid] = { ...sl.products, totalQty: 0 };
      }
      stockByProduct[pid].totalQty += sl.quantity;
    }

    for (const [, product] of Object.entries(stockByProduct)) {
      if (product.totalQty <= (product.low_stock_threshold || 5)) {
        lowStockItems.push(product);
      }
    }

    res.json({
      stats: {
        totalProducts: totalProductsRes.count || 0,
        todaySales,
        todayOrderCount: todayOrders.length,
        monthSales,
        monthOrderCount: monthOrders.length,
        lowStockCount: lowStockItems.length,
        unreadAlerts: alertsRes.data?.length || 0
      },
      lowStockItems,
      recentOrders: recentOrdersRes.data || [],
      alerts: alertsRes.data || []
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/dashboard/alerts/:id/read
router.put('/alerts/:id/read', async (req, res) => {
  try {
    await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);
    res.json({ message: 'Alert marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/dashboard/alerts/read-all
router.put('/alerts/read-all', async (req, res) => {
  try {
    await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('business_id', req.businessId)
      .eq('is_read', false);
    res.json({ message: 'All alerts marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
