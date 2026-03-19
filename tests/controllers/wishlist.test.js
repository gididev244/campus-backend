const request = require('supertest');
const express = require('express');
const Wishlist = require('../../models/Wishlist');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const User = require('../../models/User');
const wishlistRoutes = require('../../routes/wishlist');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/wishlist', wishlistRoutes);

describe('Wishlist Controller', () => {
  let buyer, seller, category, product1, product2, buyerToken;

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
  });

  afterAll(async () => {
    await close();
  });

  describe('GET /api/wishlist', () => {
    test('should get empty wishlist for new user', async () => {
      const res = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products).toEqual([]);
    });

    test('should get wishlist with products', async () => {
      const wishlist = await Wishlist.getOrCreate(buyer._id);
      await wishlist.addProduct(product1._id);

      const res = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBe(1);
    });

    test('should require auth', async () => {
      const res = await request(app).get('/api/wishlist');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/wishlist/:productId', () => {
    test('should add product to wishlist', async () => {
      const res = await request(app)
        .post(`/api/wishlist/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBe(1);
      expect(res.body.message).toMatch(/added/i);
    });

    test('should prevent duplicate products in wishlist', async () => {
      await request(app)
        .post(`/api/wishlist/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      const res = await request(app)
        .post(`/api/wishlist/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBe(1);
    });

    test('should reject non-existent product', async () => {
      const res = await request(app)
        .post('/api/wishlist/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(404);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .post(`/api/wishlist/${product1._id}`);

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/wishlist/:productId', () => {
    beforeEach(async () => {
      const wishlist = await Wishlist.getOrCreate(buyer._id);
      await wishlist.addProduct(product1._id);
      await wishlist.addProduct(product2._id);
    });

    test('should remove product from wishlist', async () => {
      const res = await request(app)
        .delete(`/api/wishlist/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBe(1);
      expect(res.body.message).toMatch(/removed/i);
    });

    test('should handle removing non-existent product', async () => {
      const res = await request(app)
        .delete('/api/wishlist/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .delete(`/api/wishlist/${product1._id}`);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/wishlist/check/:productId', () => {
    test('should return false for product not in wishlist', async () => {
      const res = await request(app)
        .get(`/api/wishlist/check/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isInWishlist).toBe(false);
    });

    test('should return true for product in wishlist', async () => {
      const wishlist = await Wishlist.getOrCreate(buyer._id);
      await wishlist.addProduct(product1._id);

      const res = await request(app)
        .get(`/api/wishlist/check/${product1._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isInWishlist).toBe(true);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .get(`/api/wishlist/check/${product1._id}`);

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/wishlist', () => {
    beforeEach(async () => {
      const wishlist = await Wishlist.getOrCreate(buyer._id);
      await wishlist.addProduct(product1._id);
      await wishlist.addProduct(product2._id);
    });

    test('should clear entire wishlist', async () => {
      const res = await request(app)
        .delete('/api/wishlist')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products).toEqual([]);
      expect(res.body.message).toMatch(/cleared/i);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .delete('/api/wishlist');

      expect(res.status).toBe(401);
    });
  });
});
