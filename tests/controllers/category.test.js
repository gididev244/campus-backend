const request = require('supertest');
const express = require('express');
const Category = require('../../models/Category');
const User = require('../../models/User');
const categoryRoutes = require('../../routes/categories');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/categories', categoryRoutes);

describe('Category Controller', () => {
  let admin, user, adminToken, userToken;

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

    user = await User.create({
      name: 'Test User',
      email: 'user@example.com',
      password: 'ValidPassword123!',
      phone: '+254711111111',
      role: 'buyer'
    });

    adminToken = generateToken(admin._id);
    userToken = generateToken(user._id);
  });

  afterAll(async () => {
    await close();
  });

  describe('GET /api/categories', () => {
    beforeEach(async () => {
      await Category.create([
        { name: 'Electronics', slug: 'electronics', description: 'Electronic devices', isActive: true },
        { name: 'Books', slug: 'books', description: 'Textbooks and novels', isActive: true },
        { name: 'Furniture', slug: 'furniture', description: 'Chairs and tables', isActive: false }
      ]);
    });

    test('should get all active categories', async () => {
      const res = await request(app).get('/api/categories');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    test('should include inactive for admin', async () => {
      const res = await request(app)
        .get('/api/categories?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });
  });

  describe('GET /api/categories/:id', () => {
    let category;

    beforeEach(async () => {
      category = await Category.create({
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices'
      });
    });

    test('should get category by ID', async () => {
      const res = await request(app).get(`/api/categories/${category._id}`);

      expect(res.status).toBe(200);
      expect(res.body.category.name).toBe('Electronics');
    });

    test('should return 404 for non-existent category', async () => {
      const res = await request(app).get('/api/categories/507f1f77bcf86cd799439011');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/categories/slug/:slug', () => {
    beforeEach(async () => {
      await Category.create({
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices'
      });
    });

    test('should get category by slug', async () => {
      const res = await request(app).get('/api/categories/slug/electronics');

      expect(res.status).toBe(200);
      expect(res.body.category.slug).toBe('electronics');
    });

    test('should return 404 for non-existent slug', async () => {
      const res = await request(app).get('/api/categories/slug/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/categories', () => {
    test('should create category as admin', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Electronics',
          slug: 'electronics',
          description: 'Electronic devices'
        });

      expect(res.status).toBe(201);
      expect(res.body.category.name).toBe('Electronics');
    });

    test('should reject creation from non-admin', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Test',
          slug: 'test'
        });

      expect(res.status).toBe(403);
    });

    test('should reject duplicate slug', async () => {
      await Category.create({ name: 'Existing', slug: 'existing' });

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Another',
          slug: 'existing'
        });

      expect(res.status).toBe(400);
    });

    test('should require auth', async () => {
      const res = await request(app)
        .post('/api/categories')
        .send({ name: 'Test', slug: 'test' });

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/categories/:id', () => {
    let category;

    beforeEach(async () => {
      category = await Category.create({
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices'
      });
    });

    test('should update category as admin', async () => {
      const res = await request(app)
        .put(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Electronics' });

      expect(res.status).toBe(200);
      expect(res.body.category.name).toBe('Updated Electronics');
    });

    test('should reject update from non-admin', async () => {
      const res = await request(app)
        .put(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Test' });

      expect(res.status).toBe(403);
    });

    test('should return 404 for non-existent category', async () => {
      const res = await request(app)
        .put('/api/categories/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/categories/:id', () => {
    let category;

    beforeEach(async () => {
      category = await Category.create({
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices'
      });
    });

    test('should delete category as admin', async () => {
      const res = await request(app)
        .delete(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await Category.findById(category._id);
      expect(deleted).toBeNull();
    });

    test('should reject delete from non-admin', async () => {
      const res = await request(app)
        .delete(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    test('should return 404 for non-existent category', async () => {
      const res = await request(app)
        .delete('/api/categories/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Category Hierarchy', () => {
    let parentCategory;

    beforeEach(async () => {
      parentCategory = await Category.create({
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices'
      });
    });

    test('should create subcategory with parent', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Phones',
          slug: 'phones',
          description: 'Mobile phones',
          parent: parentCategory._id
        });

      expect(res.status).toBe(201);
      expect(res.body.category.parent).toBe(parentCategory._id.toString());
    });

    test('should get subcategories of parent', async () => {
      await Category.create({
        name: 'Phones',
        slug: 'phones',
        parent: parentCategory._id
      });
      await Category.create({
        name: 'Laptops',
        slug: 'laptops',
        parent: parentCategory._id
      });

      const res = await request(app)
        .get(`/api/categories/${parentCategory._id}/subcategories`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });
  });
});
