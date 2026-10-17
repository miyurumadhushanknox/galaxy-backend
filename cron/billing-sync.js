const supabase = require('../config/supabase');

const PLANS = {
  monthly2k: { type: 'monthly', amount: 2000 },
  monthly5k: { type: 'monthly', amount: 5000 },
  yearly2k: { type: 'yearly', amount: 20000 },
yearly5k: { type: 'yearly', amount: 50000 },
  unlimited: { type: 'perorder', amount: 7 },
};

async function syncAllBilling() {
  console.log('⏰ Billing sync started:', new Date().toISOString());
  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, plan, knox_start_date, knox_setup_paid, knox_sub_payments, knox_sub_amounts');
    if (error) throw error;

    for (const biz of businesses) {
      const setupPaid = biz.knox_setup_paid || [false, false, false, false];
      let setupOutstanding = 0;
      setupPaid.forEach(p => { if (!p) setupOutstanding += 5000; });
      await supabase.from('businesses').update({ knox_setup_outstanding: setupOutstanding }).eq('id', biz.id);
      if (!biz.knox_start_date) continue;
      const plan = PLANS[biz.plan];
      if (!plan) continue;

if (plan.type === 'perorder') {
  const start = new Date(biz.knox_start_date);
  const now = new Date();
  const subAmounts = biz.knox_sub_amounts || {};
  const subPayments = biz.knox_sub_payments || {};

  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= now) {
    const key = d.toISOString().slice(0, 7);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();

    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', biz.id)
      .eq('status', 'delivered')
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd);

    subAmounts[key] = (count || 0) * 7;
    if (subPayments[key] === undefined) subPayments[key] = false;

    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  let subOutstanding = 0;
  Object.keys(subPayments).forEach(k => {
    if (subPayments[k] === false) subOutstanding += subAmounts[k] || 0;
  });

  await supabase.from('businesses').update({
    knox_setup_outstanding: setupOutstanding,
    knox_sub_amounts: subAmounts,
    knox_sub_payments: subPayments,
    knox_outstanding: setupOutstanding + subOutstanding
  }).eq('id', biz.id);
  continue;
}

      const start = new Date(biz.knox_start_date);
      const now = new Date();
      const subAmounts = biz.knox_sub_amounts || {};
      const subPayments = biz.knox_sub_payments || {};

      // Fill sub_amounts for all past periods
let d = new Date(start.getFullYear(), start.getMonth(), 1);
let firstMonth = true;
while (d <= now) {
  const key = plan.type === 'yearly'
    ? String(d.getFullYear())
    : d.toISOString().slice(0, 7);

  if (firstMonth && plan.type === 'monthly') {
  subAmounts[key] = 0;
  subPayments[key] = true;
} else if (!subAmounts[key]) {
  subAmounts[key] = plan.amount;
}
if (subPayments[key] === undefined) subPayments[key] = false;

  firstMonth = false;
  d = plan.type === 'yearly'
    ? new Date(d.getFullYear() + 1, d.getMonth(), 1)
    : new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
      // Calculate outstanding

let subOutstanding = 0;
Object.keys(subPayments).forEach(k => {
  if (subPayments[k] === false) subOutstanding += subAmounts[k] || 0;
});

await supabase.from('businesses').update({
  knox_setup_outstanding: setupOutstanding,
  knox_sub_amounts: subAmounts,
  knox_sub_payments: subPayments,
  knox_outstanding: setupOutstanding + subOutstanding
}).eq('id', biz.id);
    }
    console.log('✅ Billing sync done');
  } catch (e) {
    console.error('❌ Billing sync error:', e.message);
  }
}

// Run every hour
setInterval(syncAllBilling, 60 * 60 * 1000);
syncAllBilling();

module.exports = syncAllBilling;