const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

// All routes require auth
router.use(authMiddleware);

// GET /api/users - list all users for this business
router.get('/', requireRole('owner', 'admin', 'manager', 'sales'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, role, status, last_login, commission_on, commission_method, commission_percent, commission_per_unit, commission_min_cap_on, commission_min_cap, created_at')
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users - create new user
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { firstName, lastName, username, password, role, commission } = req.body;

    if (!firstName || !lastName || !username || !password || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const validRoles = ['admin', 'manager', 'sales', 'stockkeeper', 'delivery', 'accountant'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check username not already taken in this business
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('business_id', req.businessId)
      .eq('username', username.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert({
        business_id: req.businessId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.toLowerCase().trim(),
        password_hash: passwordHash,
        role,
        commission_on: commission?.on || false,
        commission_method: commission?.method || 'percent',
        commission_percent: commission?.percent || 0,
        commission_per_unit: commission?.perUnit || 0,
        commission_min_cap_on: commission?.minCapOn || false,
        commission_min_cap: commission?.minCap || 0
      })
      .select('id, first_name, last_name, username, role, status, created_at')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/users/:id - update user
router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, status, commission, newPassword } = req.body;

    // Verify user belongs to this business
    const { data: existing } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot change owner role
    if (existing.role === 'owner' && role && role !== 'owner') {
      return res.status(403).json({ error: 'Cannot change owner role' });
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (firstName) updateData.first_name = firstName.trim();
    if (lastName) updateData.last_name = lastName.trim();
    if (role) updateData.role = role;
    if (status !== undefined) updateData.status = status;
    if (commission) {
      updateData.commission_on = commission.on;
      updateData.commission_method = commission.method;
      updateData.commission_percent = commission.percent;
      updateData.commission_per_unit = commission.perUnit;
      updateData.commission_min_cap_on = commission.minCapOn;
      updateData.commission_min_cap = commission.minCap;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      updateData.password_hash = await bcrypt.hash(newPassword, 10);
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .eq('business_id', req.businessId)
      .select('id, first_name, last_name, username, email, role, status, commission_on, commission_method, commission_percent, commission_per_unit, commission_min_cap_on, commission_min_cap')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/users/:id - delete user
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Cannot delete yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Verify user belongs to this business and is not owner
    const { data: existing } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existing.role === 'owner') {
      return res.status(403).json({ error: 'Cannot delete the owner account' });
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)
      .eq('business_id', req.businessId);

    if (error) throw error;
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
