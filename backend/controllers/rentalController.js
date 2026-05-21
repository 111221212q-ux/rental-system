const Rental = require('../models/Rental');
const Item = require('../models/Item');
const Reservation = require('../models/Reservation');
const { body, validationResult } = require('express-validator');

exports.createRental = [
  body('itemId').isMongoId(),
  body('quantity').isInt({ min: 1 }),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { itemId, quantity, startDate, endDate, notes } = req.body;

      const item = await Item.findById(itemId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      if (item.available < quantity) {
        return res.status(400).json({ error: 'Not enough stock available' });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      const rentalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

      if (rentalDays > item.maxRentalDays) {
        return res.status(400).json({
          error: `Maximum rental period is ${item.maxRentalDays} days`
        });
      }

      const conflictingRentals = await Rental.find({
        item: itemId,
        status: 'active',
        $or: [
          { startDate: { $lte: end }, endDate: { $gte: start } }
        ]
      });

      const rentedQuantity = conflictingRentals.reduce((sum, r) => sum + r.quantity, 0);
      if (rentedQuantity + quantity > item.stock) {
        return res.status(400).json({
          error: `Not enough available stock for the selected dates`
        });
      }

      const rental = new Rental({
        item: itemId,
        user: req.user._id,
        quantity,
        startDate: start,
        endDate: end,
        totalCost: rentalDays * item.dailyRate,
        dailyRate: item.dailyRate,
        lateFeePerDay: item.lateFeePerDay,
        notes
      });

      if (item.requiresApproval) {
        rental.status = 'pending';
      } else {
        rental.status = 'approved';
        rental.approvedBy = req.user._id;
        rental.approvedAt = new Date();
        item.available -= quantity;
        await item.save();
      }

      await rental.save();

      await Reservation.deleteMany({
        item: itemId,
        user: req.user._id,
        status: 'confirmed'
      });

      res.status(201).json({ message: 'Rental created successfully', rental });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];

exports.getMyRentals = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const rentals = await Rental.find(filter)
      .populate('item', 'name code category dailyRate')
      .sort({ createdAt: -1 });

    res.json({ rentals, count: rentals.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllRentals = async (req, res) => {
  try {
    const { status, userId, itemId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.user = userId;
    if (itemId) filter.item = itemId;

    const rentals = await Rental.find(filter)
      .populate('user', 'username email department')
      .populate('item', 'name code category dailyRate')
      .populate('approvedBy', 'username')
      .sort({ createdAt: -1 });

    res.json({ rentals, count: rentals.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.approveRental = async (req, res) => {
  try {
    const rental = await Rental.findById(req.params.id).populate('item');
    if (!rental) {
      return res.status(404).json({ error: 'Rental not found' });
    }

    if (rental.status !== 'pending') {
      return res.status(400).json({ error: 'Rental is not pending approval' });
    }

    if (rental.item.available < rental.quantity) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }

    rental.status = 'approved';
    rental.approvedBy = req.user._id;
    rental.approvedAt = new Date();

    rental.item.available -= rental.quantity;
    await rental.item.save();

    await rental.save();

    res.json({ message: 'Rental approved successfully', rental });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.rejectRental = [
  body('reason').trim(),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const rental = await Rental.findById(req.params.id);
      if (!rental) {
        return res.status(404).json({ error: 'Rental not found' });
      }

      if (rental.status !== 'pending') {
        return res.status(400).json({ error: 'Rental is not pending approval' });
      }

      rental.status = 'rejected';
      rental.rejectReason = req.body.reason;
      await rental.save();

      res.json({ message: 'Rental rejected successfully', rental });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];

exports.startRental = async (req, res) => {
  try {
    const rental = await Rental.findById(req.params.id).populate('item');
    if (!rental) {
      return res.status(404).json({ error: 'Rental not found' });
    }

    if (rental.status !== 'approved') {
      return res.status(400).json({ error: 'Rental must be approved first' });
    }

    const now = new Date();
    if (now < rental.startDate) {
      return res.status(400).json({ error: 'Rental cannot start before start date' });
    }

    if (rental.item.available < rental.quantity) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }

    rental.status = 'active';
    rental.startDate = now;
    rental.item.available -= rental.quantity;
    await rental.item.save();
    await rental.save();

    res.json({ message: 'Rental started successfully', rental });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.returnRental = [
  body('condition').optional().isIn(['good', 'minor_damage', 'damaged', 'lost']),
  body('damageFee').optional().isFloat({ min: 0 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const rental = await Rental.findById(req.params.id).populate('item');
      if (!rental) {
        return res.status(404).json({ error: 'Rental not found' });
      }

      if (rental.status !== 'active') {
        return res.status(400).json({ error: 'Rental is not active' });
      }

      rental.status = 'returned';
      rental.returnDate = new Date();
      rental.conditionOnReturn = req.body.condition || 'good';

      if (rental.returnDate > rental.endDate) {
        const overdueDays = Math.ceil(
          (rental.returnDate - rental.endDate) / (1000 * 60 * 60 * 24)
        );
        rental.lateFee = overdueDays * rental.item.lateFeePerDay;
      }

      rental.damageFee = req.body.damageFee || 0;

      rental.item.available += rental.quantity;
      await rental.item.save();

      await rental.save();

      res.json({ message: 'Rental returned successfully', rental });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];

exports.cancelRental = async (req, res) => {
  try {
    const rental = await Rental.findById(req.params.id).populate('item');
    if (!rental) {
      return res.status(404).json({ error: 'Rental not found' });
    }

    if (!['pending', 'approved'].includes(rental.status)) {
      return res.status(400).json({ error: 'Cannot cancel this rental' });
    }

    if (rental.status === 'approved') {
      rental.item.available += rental.quantity;
      await rental.item.save();
    }

    rental.status = 'cancelled';
    await rental.save();

    res.json({ message: 'Rental cancelled successfully', rental });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.checkOverdueRentals = async (req, res) => {
  try {
    const now = new Date();
    const overdueRentals = await Rental.find({
      status: 'active',
      endDate: { $lt: now },
      overdueReminderSent: false
    }).populate('user', 'email username').populate('item', 'name');

    for (const rental of overdueRentals) {
      rental.overdueReminderSent = true;
      await rental.save();
    }

    res.json({
      message: `Found ${overdueRentals.length} overdue rentals`,
      count: overdueRentals.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRentalStats = async (req, res) => {
  try {
    const stats = await Rental.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          overdue: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'active'] }, { $lt: ['$endDate', new Date()] }] },
                1,
                0
              ]
            }
          },
          totalRevenue: { $sum: '$totalCost' },
          totalLateFees: { $sum: '$lateFee' },
          totalDamageFees: { $sum: '$damageFee' }
        }
      }
    ]);

    res.json({ stats: stats[0] || {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};