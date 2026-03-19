const request = require('supertest');
const express = require('express');
const Review = require('../../models/Review');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const User = require('../../models/User');
const reviewRoutes = require('../../routes/reviews');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);

describe('Review Controller', () => {
  let buyer, seller, admin, category, product, order, buyerToken, sellerToken, adminToken;

  beforeAll(async () => {
    await connect();
  });

  beforeEach(async () => {
    await clear();

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

    admin = await User.create({
      name: 'Test Admin',
      email: 'admin@example.com',
      password: 'ValidPassword123!',
      phone: '+254722222222',
      role: 'admin'
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
      shippingAddress: { street: '123 Main St' }
    });

    buyerToken = generateToken(buyer._id);
    sellerToken = generateToken(seller._id);
    adminToken = generateToken(admin._id);
  });

  afterAll(async () => {
    await close();
  });

  describe('POST /api/reviews', () => {
    test('should create review for delivered order', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          reviewedUser: seller._id,
          product: product._id,
          order: order._id,
          rating: 5,
          comment: 'Great seller, fast shipping!'
        });

      expect(res.status).toBe(201);
      expect(res.body.review.rating).toBe(5);
      expect(res.body.review.comment).toBe('Great seller, fast shipping!');
    });

    test('should reject review for non-delivered order', async () => {
      await Order.findByIdAndUpdate(order._id, { status: 'pending' });

      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          reviewedUser: seller._id,
          product: product._id,
          order: order._id,
          rating: 5,
          comment: 'Test review'
        });

      expect(res.status).toBe(400);
    });

    test('should reject duplicate review for same order', async () => {
      await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 4
      });

      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          reviewedUser: seller._id,
          product: product._id,
          order: order._id,
          rating: 5,
          comment: 'Another review'
        });

      expect(res.status).toBe(400);
    });

    test('should reject review from non-buyer', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          reviewedUser: buyer._id,
          product: product._id,
          order: order._id,
          rating: 5,
          comment: 'Test'
        });

      expect(res.status).toBe(403);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({
          reviewedUser: seller._id,
          product: product._id,
          order: order._id,
          rating: 5
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/reviews/user/:userId', () => {
    beforeEach(async () => {
      await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 5,
        comment: 'Great!'
      });
    });

    test('should get reviews for user', async () => {
      const res = await request(app)
        .get(`/api/reviews/user/${seller._id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].rating).toBe(5);
    });

    test('should return empty for user with no reviews', async () => {
      const res = await request(app)
        .get(`/api/reviews/user/${buyer._id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });

    test('should paginate results', async () => {
      const res = await request(app)
        .get(`/api/reviews/user/${seller._id}?page=1&limit=10`);

      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('GET /api/reviews/my-reviews', () => {
    beforeEach(async () => {
      await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 4,
        comment: 'Good'
      });
    });

    test('should get reviews written by user', async () => {
      const res = await request(app)
        .get('/api/reviews/my-reviews')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .get('/api/reviews/my-reviews');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/reviews/:id', () => {
    let review;

    beforeEach(async () => {
      review = await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 5,
        comment: 'Excellent'
      });
    });

    test('should get review by ID', async () => {
      const res = await request(app)
        .get(`/api/reviews/${review._id}`);

      expect(res.status).toBe(200);
      expect(res.body.review.rating).toBe(5);
    });

    test('should return 404 for non-existent review', async () => {
      const res = await request(app)
        .get('/api/reviews/507f1f77bcf86cd799439011');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/reviews/:id', () => {
    let review;

    beforeEach(async () => {
      review = await Review.create({
        reviewer: buyer._id,
        reviewedUser: seller._id,
        product: product._id,
        order: order._id,
        rating: 4,
        comment: 'Good'
      });
    });

    test('should update own review', async () => {
      const res = await request(app)
        .put(`/api/reviews/${review._id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 5, comment: 'Updated: Excellent!' });

      expect(res.status).toBe(200);
      expect(res.body.review.rating).toBe(5);
      expect(res.body.review.comment).toBe('Updated: Excellent!');
    });

    test('should reject update from non-owner', async () => {
      const res = await request(app)
        .put(`/api/reviews/${review._id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ rating: 1 });

      expect(res.status).toBe(403);
    });

    test('should return 404 for non-existent review', async () => {
      const res = await request(app)
        .put('/api/reviews/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 5 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/reviews/:id', () => {
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

    test('should delete own review', async () => {
      const res = await request(app)
        .delete(`/api/reviews/${review._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await Review.findById(review._id);
      expect(deleted).toBeNull();
    });

    test('should allow admin to delete any review', async () => {
      const res = await request(app)
        .delete(`/api/reviews/${review._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('should reject delete from non-owner non-admin', async () => {
      const res = await request(app)
        .delete(`/api/reviews/${review._id}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
    });

    test('should return 404 for non-existent review', async () => {
      const res = await request(app)
        .delete('/api/reviews/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(404);
    });
  });
});
