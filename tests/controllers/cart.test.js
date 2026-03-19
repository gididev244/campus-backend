const request = require('supertest');
const express = require('express');
const Cart = require('../../models/Cart');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const User = require('../../models/User');
const cartRoutes = require('../../routes/cart');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/cart', cartRoutes);

describe('Cart Controller', () => {
  let buyer, seller, category, product1, product2, buyerToken, sellerToken;

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

    category = await Category.create({
      name: 'Electronics',
      slug: 'electronics',
      description: 'Electronic devices'
    });

    product1 = await Product.create({
      title: 'iPhone 13',
      description: 'Brand new iPhone',
      price: 50000,
      category: category._id,
      seller: seller._id,
      condition: 'new',
      location: 'Nairobi',
      status: 'available'
    });

    product2 = await Product.create({
      title: 'Samsung Galaxy',
      description: 'Used Samsung phone',
      price: 30000,
      category: category._id,
      seller: seller._id,
      condition: 'good',
      location: 'Mombasa',
      status: 'available'
    });

    buyerToken = generateToken(buyer._id);
    sellerToken = generateToken(seller._id);
  });

  afterAll(async () => {
    await close();
  });

  describe('GET /api/cart', () => {
    test('should get empty cart for new user', async () => {
      const res = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
    });

    test('should get cart with items', async () => {
      const cart = await Cart.getOrCreate(buyer._id);
      await cart.addItem(product1._id, 1);

      const res = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
    });

    test('should require auth', async () => {
      const res = await request(app).get('/api/cart');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/cart/items', () => {
    test('should add item to cart', async () => {
      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: product1._id, quantity: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/added/i);
      expect(res.body.data.items.length).toBe(1);
    });

    test('should increase quantity if item already in cart', async () => {
      await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: product1._id, quantity: 1 });

      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: product1._id, quantity: 2 });

      expect(res.status).toBe(200);
      const item = res.body.data.items.find(i => i.product._id.toString() === product1._id.toString());
      expect(item.quantity).toBe(3);
    });

    test('should prevent seller from buying own product', async () => {
      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ productId: product1._id, quantity: 1 });

      expect(res.status).toBe(400);
    });

    test('should reject non-existent product', async () => {
      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: '507f1f77bcf86cd799439011', quantity: 1 });

      expect(res.status).toBe(404);
    });

    test('should reject unavailable product', async () => {
      await Product.findByIdAndUpdate(product1._id, { status: 'sold' });

      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: product1._id, quantity: 1 });

      expect(res.status).toBe(400);
    });

    test('should reject invalid quantity', async () => {
      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: product1._id, quantity: 0 });

      expect(res.status).toBe(400);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .post('/api/cart/items')
        .send({ productId: product1._id, quantity: 1 });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/cart/items/:productId', () => {
    beforeEach(async () => {
      const cart = await Cart.getOrCreate(buyer._id);
      await cart.addItem(product1._id, 1);
      await cart.addItem(product2._id, 1);
    });

    test('should remove item from cart', async () => {
      const res = await request(app)
        .delete(`/api/cart/items/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].product._id.toString()).toBe(product2._id.toString());
    });

    test('should handle removing non-existent item', async () => {
      const res = await request(app)
        .delete('/api/cart/items/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .delete(`/api/cart/items/${product1._id}`);

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/cart/items/:productId', () => {
    beforeEach(async () => {
      const cart = await Cart.getOrCreate(buyer._id);
      await cart.addItem(product1._id, 1);
    });

    test('should update item quantity', async () => {
      const res = await request(app)
        .put(`/api/cart/items/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ quantity: 3 });

      expect(res.status).toBe(200);
      const item = res.body.data.items.find(i => i.product._id.toString() === product1._id.toString());
      expect(item.quantity).toBe(3);
    });

    test('should reject quantity less than 1', async () => {
      const res = await request(app)
        .put(`/api/cart/items/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ quantity: 0 });

      expect(res.status).toBe(400);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .put(`/api/cart/items/${product1._id}`)
        .send({ quantity: 2 });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/cart', () => {
    beforeEach(async () => {
      const cart = await Cart.getOrCreate(buyer._id);
      await cart.addItem(product1._id, 1);
      await cart.addItem(product2._id, 2);
    });

    test('should clear entire cart', async () => {
      const res = await request(app)
        .delete('/api/cart')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .delete('/api/cart');

      expect(res.status).toBe(401);
    });
  });
});
