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

rentalSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

rentalSchema.index({ user: 1, status: 1 });
rentalSchema.index({ item: 1, status: 1 });
rentalSchema.index({ endDate: 1, status: 1 });

module.exports = mongoose.model('Rental', rentalSchema);