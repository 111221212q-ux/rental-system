const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  category: {
    type: String,
    required: true,
    enum: ['电子产品', '办公用品', '运动器材', '生活用品', '其他', 'electronics', 'furniture', 'tools', 'sports', 'books', 'others']
  },
  description: {
    type: String,
    trim: true
  },
  stock: {
    type: Number,
    required: true,
    min: 0,
    default: 1
  },
  available: {
    type: Number,
    required: true,
    min: 0
  },
  dailyRate: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  damageFee: {
    type: Number,
    default: 0
  },
  lateFeePerDay: {
    type: Number,
    default: 0
  },
  maxRentalDays: {
    type: Number,
    default: 30
  },
  maxRentalQty: {
    type: Number,
    default: 5
  },
  value: {
    type: Number,
    default: 0
  },
  image: {
    type: String
  },
  datasheetUrl: {
    type: String
  },
  status: {
    type: String,
    enum: ['available', 'low_stock', 'unavailable'],
    default: 'available'
  },
  requiresApproval: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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

itemSchema.pre('save', function() {
  if (this.available === 0) {
    this.status = 'unavailable';
  } else if (this.available <= this.stock * 0.2) {
    this.status = 'low_stock';
  } else {
    this.status = 'available';
  }
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Item', itemSchema);