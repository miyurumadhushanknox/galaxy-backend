const supabase = require('../lib/supabase');

const PLANS = {
  basic: { type: 'monthly', amount: 2000 },
  nova: { type: 'monthly', amount: 5000 },
  stellar: { type: 'perorder', amount: 7 },
};

async function syncAllBilling() {
  console.log('⏰ Billing sync started:', new Date().toISOString());
  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, plan, knox_start_date, knox_setup_paid, knox_sub_payments, knox_sub_amounts');
    if (error) throw error;

    for (const biz of businesses) {
      if (!biz.knox_start_date) continue;
      const plan = PLANS[biz.plan];
      if (!plan || plan.type === 'perorder') continue;

      const start = new Date(biz.knox_start_date);
      const now = new Date();
      const subAmounts = biz.knox_sub_amounts || {};
      const subPayments = biz.knox_sub_payments || {};
      const setupPaid = biz.knox_setup_paid || [false, false, false, false];

      // Fill sub_amounts for all past months
      let d = new Date(start.getFullYear(), start.getMonth(), 1);
      let firstMonth = true;
      while (d <= now) {
        const key = d.toISOString().slice(0, 7);
        if (!firstMonth && (!subAmounts[key] || subAmounts[key] === 0)) {
          subAmounts[key] = plan.amount;
        }
        firstMonth = false;
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }

      // Calculate outstanding
      let outstanding = 0;
      setupPaid.forEach(p => { if (!p) outstanding += 5000; });
      Object.keys(subPayments).forEach(k => {
        if (!subPayments[k]) outstanding += subAmounts[k] || 0;
      });

      await supabase.from('businesses').update({
        knox_sub_amounts: subAmounts,
        knox_outstanding: outstanding
      }).eq('id', biz.id);
    }
    console.log('✅ Billing sync done');
  } catch (e) {
    console.error('❌ Billing sync error:', e.message);
  }
}

// Run every hour
syncAllBilling();
setInterval(syncAllBilling, 60 * 60 * 1000);

module.exports = syncAllBilling;