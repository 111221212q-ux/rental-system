const Item = require('../models/Item');
const { body, validationResult } = require('express-validator');

exports.getAllItems = async (req, res) => {
  try {
    const { category, status, search } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const items = await Item.find(filter).sort({ createdAt: -1 });
    res.json({ items, count: items.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getItemById = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createItem = [
  body('name').trim().notEmpty(),
  body('code').trim().notEmpty().isUppercase(),
  body('category').isIn(['electronics', 'furniture', 'tools', 'sports', 'books', 'others']),
  body('stock').isInt({ min: 1 }),
  body('dailyRate').isFloat({ min: 0 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const item = new Item({
        ...req.body,
        available: req.body.stock,
        createdBy: req.user._id
      });

      await item.save();
      res.status(201).json({ message: 'Item created successfully', item });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: 'Item code already exists' });
      }
      res.status(500).json({ error: error.message });
    }
  }
];

exports.updateItem = [
  body('name').optional().trim().notEmpty(),
  body('code').optional().trim().notEmpty().isUppercase(),
  body('category').optional().isIn(['electronics', 'furniture', 'tools', 'sports', 'books', 'others']),
  body('stock').optional().isInt({ min: 1 }),
  body('dailyRate').optional().isFloat({ min: 0 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const item = await Item.findById(req.params.id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const stockChanged = req.body.stock && req.body.stock !== item.stock;
      const availableChange = req.body.stock - item.stock;

      Object.assign(item, req.body);

      if (stockChanged) {
        item.available = Math.max(0, item.available + availableChange);
      }

      await item.save();
      res.json({ message: 'Item updated successfully', item });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];

exports.deleteItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.available < item.stock) {
      return res.status(400).json({ error: 'Cannot delete item with active rentals' });
    }

    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getItemStats = async (req, res) => {
  try {
    const stats = await Item.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalStock: { $sum: '$stock' },
          totalAvailable: { $sum: '$available' },
          byCategory: {
            $push: {
              category: '$category',
              count: 1,
              stock: '$stock',
              available: '$available'
            }
          },
          byStatus: {
            $push: {
              status: '$status',
              count: 1
            }
          }
        }
      }
    ]);

    res.json({ stats: stats[0] || {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};