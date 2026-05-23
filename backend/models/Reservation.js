const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'expired', 'converted'],
    default: 'pending'
  },
  expiresAt: {
    type: Date
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

reservationSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

reservationSchema.index({ item: 1, startDate: 1, endDate: 1 });
reservationSchema.index({ user: 1, status: 1 });
reservationSchema.index({ expiresAt: 1, status: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);