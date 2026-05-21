const express = require('express');
const router = express.Router();
const itemController = require('../controllers/itemController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.get('/', auth, itemController.getAllItems);
router.get('/stats', auth, admin, itemController.getItemStats);
router.get('/:id', auth, itemController.getItemById);
router.post('/', auth, admin, itemController.createItem);
router.put('/:id', auth, admin, itemController.updateItem);
router.delete('/:id', auth, admin, itemController.deleteItem);

module.exports = router;