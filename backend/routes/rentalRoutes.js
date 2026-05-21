const express = require('express');
const router = express.Router();
const rentalController = require('../controllers/rentalController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.post('/', auth, rentalController.createRental);
router.get('/my', auth, rentalController.getMyRentals);
router.get('/all', auth, admin, rentalController.getAllRentals);
router.get('/stats', auth, admin, rentalController.getRentalStats);
router.post('/check-overdue', auth, admin, rentalController.checkOverdueRentals);

router.patch('/:id/approve', auth, admin, rentalController.approveRental);
router.patch('/:id/reject', auth, admin, rentalController.rejectRental);
router.patch('/:id/start', auth, admin, rentalController.startRental);
router.patch('/:id/return', auth, rentalController.returnRental);
router.patch('/:id/cancel', auth, rentalController.cancelRental);

module.exports = router;