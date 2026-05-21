const mongoose = require('mongoose');

const rentalSchema = new mongoose.Schema({
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  returnDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'active', 'returned', 'overdue', 'cancelled'],
    default: 'pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectReason: {
    type: String
  },
  totalCost: {
    type: Number,
    default: 0
  },
  lateFee: {
    type: Number,
    default: 0
  },
  damageFee: {
    type: Number,
    default: 0
  },
  notes: {
    type: String
  },
  conditionOnReturn: {
    type: String,
    enum: ['good', 'minor_damage', 'damaged', 'lost'],
    default: 'good'
  },
  reminderSent: {
    type: Boolean,
    default: false
  },
  overdueReminderSent: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

rentalSchema.pre('save', function(next) {
  this.updatedAt = Date.now();

  const daysDiff = Math.ceil((this.endDate - this.startDate) / (1000 * 60 * 60 * 24));
  this.totalCost = daysDiff * this.dailyRate;

  if (this.returnDate && this.returnDate > this.endDate) {
    const overdueDays = Math.ceil((this.returnDate - this.endDate) / (1000 * 60 * 60 * 24));
    this.lateFee = overdueDays * this.lateFeePerDay;
  }

  next();
});

rentalSchema.index({ user: 1, status: 1 });
rentalSchema.index({ item: 1, status: 1 });
rentalSchema.index({ endDate: 1, status: 1 });

module.exports = mongoose.model('Rental', rentalSchema);