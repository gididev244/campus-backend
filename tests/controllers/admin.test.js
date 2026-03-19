const request = require('supertest');
const express = require('express');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const User = require('../../models/User');
const Review = require('../../models/Review');
const adminRoutes = require('../../routes/admin');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

describe('Admin Controller', () => {
  let buyer, seller, admin, category, product, order, adminToken;

  beforeAll(async () => {
    await connect();
  });

  beforeEach(async () => {
    await clear();

    admin = await User.create({
      name: 'Test Admin',
      email: 'admin@example.com',
      password: 'ValidPassword123!',
      phone: '+254722222222',
      role: 'admin'
    });

    seller = await User.create({
      name: 'Test Seller',
      email: 'seller@example.com',
      password: 'ValidPassword123!',
      phone: '+254712345678',
      role: 'seller'
    });

    buyer = await User.create({
      name: 'Test Buyer',
      email: 'buyer@example.com',
      password: 'ValidPassword123!',
      phone: '+254711111111',
      role: 'buyer'
    });

    category = await Category.create({
      name: 'Electronics',
      slug: 'electronics',
      description: 'Electronic devices'
    });

    product = await Product.create({
      title: 'iPhone 13',
      description: 'Brand new iPhone',
      price: 50000,
      category: category._id,
      seller: seller._id,
      condition: 'new',
      location: 'Nairobi',
      status: 'sold'
    });

    order = await Order.create({
      buyer: buyer._id,
      seller: seller._id,
      product: product._id,
      totalPrice: 50000,
      status: 'delivered',
      paymentStatus: 'completed',
      shippingAddress: { street: '123 Main St' }
    });

    adminToken = generateToken(admin._id);
  });

  afterAll(async () => {
    await close();
  });

  describe('GET /api/admin/analytics/revenue', () => {
    test('should get revenue analytics', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/revenue')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalRevenue).toBeDefined();
      expect(res.body.data.dailyRevenue).toBeDefined();
    });

    test('should support different periods', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/revenue?period=30d')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.period).toBe('30d');
    });

    test('should require admin auth', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/revenue');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/analytics/users', () => {
    test('should get user analytics', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalUsers).toBe(3);
      expect(res.body.data.usersByRole).toBeDefined();
    });

    test('should count users by role', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.data.usersByRole.admin).toBe(1);
      expect(res.body.data.usersByRole.seller).toBe(1);
      expect(res.body.data.usersByRole.buyer).toBe(1);
    });
  });

  describe('GET /api/admin/analytics/orders', () => {
    test('should get order analytics', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalOrders).toBe(1);
      expect(res.body.data.ordersByStatus).toBeDefined();
      expect(res.body.data.completionRate).toBeDefined();
    });
  });

  describe('GET /api/admin/analytics/products', () => {
    test('should get product analytics', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/products')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalProducts).toBe(1);
      expect(res.body.data.productsByStatus).toBeDefined();
      expect(res.body.data.topCategories).toBeDefined();
    });
  });

  describe('GET /api/admin/reviews', () => {
    beforeEach(async () => {
      await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 5,
        comment: 'Great seller!'
      });
    });

    test('should get all reviews for moderation', async () => {
      const res = await request(app)
        .get('/api/admin/reviews')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should filter reviews by rating', async () => {
      const res = await request(app)
        .get('/api/admin/reviews?rating=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should paginate reviews', async () => {
      const res = await request(app)
        .get('/api/admin/reviews?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('DELETE /api/admin/reviews/:id', () => {
    let review;

    beforeEach(async () => {
      review = await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 3,
        comment: 'Average'
      });
    });

    test('should delete review as admin', async () => {
      const res = await request(app)
        .delete(`/api/admin/reviews/${review._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await Review.findById(review._id);
      expect(deleted).toBeNull();
    });

    test('should return 404 for non-existent review', async () => {
      const res = await request(app)
        .delete('/api/admin/reviews/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/admin/payouts/ledger', () => {
    beforeEach(async () => {
      await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 30000,
        status: 'delivered',
        paymentStatus: 'completed',
        sellerPaid: false,
        shippingAddress: { street: '123 St' }
      });
    });

    test('should get payout ledger', async () => {
      const res = await request(app)
        .get('/api/admin/payouts/ledger')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.pendingPayoutTotal).toBeDefined();
    });

    test('should require admin auth', async () => {
      const res = await request(app)
        .get('/api/admin/payouts/ledger');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/admin/payouts/:orderId/pay', () => {
    let unpaidOrder;

    beforeEach(async () => {
      unpaidOrder = await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 25000,
        status: 'delivered',
        paymentStatus: 'completed',
        sellerPaid: false,
        shippingAddress: { street: '123 St' }
      });
    });

    test('should mark seller as paid', async () => {
      const res = await request(app)
        .put(`/api/admin/payouts/${unpaidOrder._id}/pay`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Paid via M-Pesa' });

      expect(res.status).toBe(200);
      expect(res.body.order.sellerPaid).toBe(true);
    });

    test('should reject unpaid order', async () => {
      await Order.findByIdAndUpdate(unpaidOrder._id, { paymentStatus: 'pending' });

      const res = await request(app)
        .put(`/api/admin/payouts/${unpaidOrder._id}/pay`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    test('should reject already paid order', async () => {
      await Order.findByIdAndUpdate(unpaidOrder._id, { sellerPaid: true });

      const res = await request(app)
        .put(`/api/admin/payouts/${unpaidOrder._id}/pay`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });
});
