const request = require('supertest');
const express = require('express');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const User = require('../../models/User');
const orderRoutes = require('../../routes/orders');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);

describe('Order Controller', () => {
  let buyer, seller, admin, category, product, buyerToken, sellerToken, adminToken;

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
      status: 'available'
    });

    buyerToken = generateToken(buyer._id);
    sellerToken = generateToken(seller._id);
    adminToken = generateToken(admin._id);
  });

  afterAll(async () => {
    await close();
  });

  describe('POST /api/orders', () => {
    test('should create order successfully', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          productId: product._id,
          quantity: 1,
          shippingAddress: {
            street: '123 Main St',
            city: 'Nairobi'
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.order.status).toBe('pending');
      expect(res.body.order.totalPrice).toBe(50000);

      const updatedProduct = await Product.findById(product._id);
      expect(updatedProduct.status).toBe('pending');
    });

    test('should reject seller buying own product', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          productId: product._id,
          quantity: 1,
          shippingAddress: { street: '123 St' }
        });

      expect(res.status).toBe(400);
    });

    test('should reject order for unavailable product', async () => {
      await Product.findByIdAndUpdate(product._id, { status: 'sold' });

      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          productId: product._id,
          quantity: 1,
          shippingAddress: { street: '123 St' }
        });

      expect(res.status).toBe(400);
    });

    test('should reject order for non-existent product', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          productId: '507f1f77bcf86cd799439011',
          quantity: 1,
          shippingAddress: { street: '123 St' }
        });

      expect(res.status).toBe(404);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({
          productId: product._id,
          quantity: 1
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/orders', () => {
    let order;

    beforeEach(async () => {
      order = await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 50000,
        status: 'pending',
        shippingAddress: { street: '123 Main St' }
      });
    });

    test('should get orders as buyer', async () => {
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should get orders as seller', async () => {
      const res = await request(app)
        .get('/api/orders?as=seller')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should filter orders by status', async () => {
      const res = await request(app)
        .get('/api/orders?status=pending')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should return empty for no matching status', async () => {
      const res = await request(app)
        .get('/api/orders?status=delivered')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });
  });

  describe('GET /api/orders/:id', () => {
    let order;

    beforeEach(async () => {
      order = await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 50000,
        status: 'pending',
        shippingAddress: { street: '123 Main St' }
      });
    });

    test('should get order by ID as buyer', async () => {
      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.order._id.toString()).toBe(order._id.toString());
    });

    test('should get order by ID as seller', async () => {
      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
    });

    test('should get order by ID as admin', async () => {
      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('should reject unauthorized user', async () => {
      const otherUser = await User.create({
        name: 'Other User',
        email: 'other@example.com',
        password: 'ValidPassword123!',
        phone: '+254733333333',
        role: 'buyer'
      });
      const otherToken = generateToken(otherUser._id);

      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/orders/:id/status', () => {
    let order;

    beforeEach(async () => {
      order = await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 50000,
        status: 'pending',
        shippingAddress: { street: '123 Main St' }
      });
    });

    test('should update status from pending to confirmed', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('confirmed');
    });

    test('should update status from confirmed to shipped', async () => {
      await Order.findByIdAndUpdate(order._id, { status: 'confirmed' });

      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ status: 'shipped' });

      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('shipped');
      expect(res.body.order.shippedAt).toBeDefined();
    });

    test('should update status from shipped to delivered', async () => {
      await Order.findByIdAndUpdate(order._id, { status: 'shipped' });

      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ status: 'delivered' });

      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('delivered');
      expect(res.body.order.deliveredAt).toBeDefined();
    });

    test('should reject invalid status transition', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ status: 'delivered' });

      expect(res.status).toBe(400);
    });

    test('should allow admin to update status', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(200);
    });

    test('should reject buyer from updating status', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/orders/:id/cancel', () => {
    let order;

    beforeEach(async () => {
      order = await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 50000,
        status: 'pending',
        shippingAddress: { street: '123 Main St' }
      });
    });

    test('should cancel pending order as buyer', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/cancel`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ reason: 'Changed mind' });

      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('cancelled');
      expect(res.body.order.cancellationReason).toBe('Changed mind');

      const updatedProduct = await Product.findById(product._id);
      expect(updatedProduct.status).toBe('available');
    });

    test('should reject cancelling non-pending order', async () => {
      await Order.findByIdAndUpdate(order._id, { status: 'confirmed' });

      const res = await request(app)
        .put(`/api/orders/${order._id}/cancel`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(400);
    });

    test('should reject seller from cancelling buyer order', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/cancel`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/orders/:id/confirm-received', () => {
    let order;

    beforeEach(async () => {
      order = await Order.create({
        buyer: buyer._id,
        seller: seller._id,
        product: product._id,
        totalPrice: 50000,
        status: 'shipped',
        shippingAddress: { street: '123 Main St' }
      });
    });

    test('should confirm received as buyer', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/confirm-received`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('delivered');
      expect(res.body.order.deliveredAt).toBeDefined();
    });

    test('should reject confirm on non-shipped order', async () => {
      await Order.findByIdAndUpdate(order._id, { status: 'pending' });

      const res = await request(app)
        .put(`/api/orders/${order._id}/confirm-received`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(400);
    });

    test('should reject seller from confirming', async () => {
      const res = await request(app)
        .put(`/api/orders/${order._id}/confirm-received`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
    });
  });
});
