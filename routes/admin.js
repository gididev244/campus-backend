const express = require('express');
const {
  getRevenueAnalytics,
  getUserAnalytics,
  getOrderAnalytics,
  getProductAnalytics,
  getAllReviews,
  deleteReview,
  getWithdrawalRequests,
  processWithdrawalRequest,
  getUserBalance,
  getUsersWithBalances
} = require('../controllers/admin');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);
router.use(authorize('admin'));

router.get('/analytics/revenue', getRevenueAnalytics);
router.get('/analytics/users', getUserAnalytics);
router.get('/analytics/orders', getOrderAnalytics);
router.get('/analytics/products', getProductAnalytics);

router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteReview);

router.get('/withdrawals', getWithdrawalRequests);
router.put('/withdrawals/:requestId', processWithdrawalRequest);

router.get('/users/:userId/balance', getUserBalance);
router.get('/users/with-balances', getUsersWithBalances);

module.exports = router;
