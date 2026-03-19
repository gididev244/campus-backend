const request = require('supertest');
const express = require('express');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const User = require('../../models/User');
const productRoutes = require('../../routes/products');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

const app = express();
app.use(express.json());
app.use('/api/products', productRoutes);

describe('Product Controller', () => {
  let seller, buyer, category, sellerToken, buyerToken;

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

    sellerToken = generateToken(seller._id);
    buyerToken = generateToken(buyer._id);
  });

  afterAll(async () => {
    await close();
  });

  describe('GET /api/products', () => {
    beforeEach(async () => {
      await Product.create([
        {
          title: 'iPhone 13',
          description: 'Brand new iPhone',
          price: 50000,
          category: category._id,
          seller: seller._id,
          condition: 'new',
          location: 'Nairobi',
          status: 'available'
        },
        {
          title: 'Samsung Galaxy',
          description: 'Used Samsung phone',
          price: 30000,
          category: category._id,
          seller: seller._id,
          condition: 'good',
          location: 'Mombasa',
          status: 'available'
        },
        {
          title: 'MacBook Pro',
          description: 'Refurbished laptop',
          price: 80000,
          category: category._id,
          seller: seller._id,
          condition: 'like-new',
          location: 'Nairobi',
          status: 'sold'
        }
      ]);
    });

    test('should get all available products', async () => {
      const res = await request(app).get('/api/products');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    test('should search products by title', async () => {
      const res = await request(app).get('/api/products?search=iPhone');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].title).toBe('iPhone 13');
    });

    test('should filter by category', async () => {
      const res = await request(app).get(`/api/products?category=${category._id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    test('should filter by condition', async () => {
      const res = await request(app).get('/api/products?condition=new');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].condition).toBe('new');
    });

    test('should filter by price range', async () => {
      const res = await request(app).get('/api/products?minPrice=25000&maxPrice=55000');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    test('should filter by location', async () => {
      const res = await request(app).get('/api/products?location=Nairobi');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    test('should sort by price ascending', async () => {
      const res = await request(app).get('/api/products?sortBy=price&sortOrder=asc');

      expect(res.status).toBe(200);
      expect(res.body.data[0].price).toBe(30000);
      expect(res.body.data[1].price).toBe(50000);
    });

    test('should sort by price descending', async () => {
      const res = await request(app).get('/api/products?sortBy=price&sortOrder=desc');

      expect(res.status).toBe(200);
      expect(res.body.data[0].price).toBe(50000);
      expect(res.body.data[1].price).toBe(30000);
    });

    test('should paginate results', async () => {
      const res = await request(app).get('/api/products?page=1&limit=1');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.pagination.pages).toBe(2);
    });
  });

  describe('GET /api/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await Product.create({
        title: 'Test Product',
        description: 'Test Description',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi'
      });
    });

    test('should get product by ID', async () => {
      const res = await request(app).get(`/api/products/${product._id}`);

      expect(res.status).toBe(200);
      expect(res.body.product.title).toBe('Test Product');
    });

    test('should increment view count', async () => {
      await request(app).get(`/api/products/${product._id}`);

      const updated = await Product.findById(product._id);
      expect(updated.views).toBe(1);
    });

    test('should return 404 for non-existent product', async () => {
      const res = await request(app).get('/api/products/507f1f77bcf86cd799439011');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/products', () => {
    test('should create product as seller', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'New Product',
          description: 'Description',
          price: 5000,
          category: category._id,
          condition: 'new',
          location: 'Nairobi',
          images: ['https://example.com/image.jpg']
        });

      expect(res.status).toBe(201);
      expect(res.body.product.title).toBe('New Product');
      expect(res.body.product.status).toBe('available');
    });

    test('should reject product creation from buyer', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          title: 'New Product',
          description: 'Description',
          price: 5000,
          category: category._id,
          condition: 'new',
          location: 'Nairobi'
        });

      expect(res.status).toBe(403);
    });

    test('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({
          title: 'New Product',
          description: 'Description',
          price: 5000,
          category: category._id,
          condition: 'new',
          location: 'Nairobi'
        });

      expect(res.status).toBe(401);
    });

    test('should reject invalid category', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'New Product',
          description: 'Description',
          price: 5000,
          category: '507f1f77bcf86cd799439011',
          condition: 'new',
          location: 'Nairobi'
        });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await Product.create({
        title: 'Test Product',
        description: 'Test Description',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi'
      });
    });

    test('should update own product', async () => {
      const res = await request(app)
        .put(`/api/products/${product._id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ price: 2000, title: 'Updated Title' });

      expect(res.status).toBe(200);
      expect(res.body.product.price).toBe(2000);
      expect(res.body.product.title).toBe('Updated Title');
    });

    test('should reject update from non-owner', async () => {
      const res = await request(app)
        .put(`/api/products/${product._id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ price: 2000 });

      expect(res.status).toBe(403);
    });

    test('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .put('/api/products/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ price: 2000 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await Product.create({
        title: 'Test Product',
        description: 'Test Description',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi'
      });
    });

    test('should delete own product', async () => {
      const res = await request(app)
        .delete(`/api/products/${product._id}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await Product.findById(product._id);
      expect(deleted).toBeNull();
    });

    test('should reject delete from non-owner', async () => {
      const res = await request(app)
        .delete(`/api/products/${product._id}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/products/:id/like', () => {
    let product;

    beforeEach(async () => {
      product = await Product.create({
        title: 'Test Product',
        description: 'Test Description',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi'
      });
    });

    test('should like a product', async () => {
      const res = await request(app)
        .post(`/api/products/${product._id}/like`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.liked).toBe(true);
      expect(res.body.likesCount).toBe(1);
    });

    test('should unlike a product', async () => {
      await request(app)
        .post(`/api/products/${product._id}/like`)
        .set('Authorization', `Bearer ${buyerToken}`);

      const res = await request(app)
        .post(`/api/products/${product._id}/like`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.liked).toBe(false);
      expect(res.body.likesCount).toBe(0);
    });

    test('should require auth to like', async () => {
      const res = await request(app)
        .post(`/api/products/${product._id}/like`);

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/products/:id/relist', () => {
    let soldProduct;

    beforeEach(async () => {
      soldProduct = await Product.create({
        title: 'Sold Product',
        description: 'Already sold',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'good',
        location: 'Nairobi',
        status: 'sold'
      });
    });

    test('should relist a sold product', async () => {
      const res = await request(app)
        .post(`/api/products/${soldProduct._id}/relist`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ price: 800 });

      expect(res.status).toBe(201);
      expect(res.body.product.status).toBe('available');
      expect(res.body.product.price).toBe(800);
    });

    test('should reject relist from non-owner', async () => {
      const res = await request(app)
        .post(`/api/products/${soldProduct._id}/relist`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/products/:id/related', () => {
    let product1, product2;

    beforeEach(async () => {
      product1 = await Product.create({
        title: 'Product 1',
        description: 'First product',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi',
        status: 'available'
      });

      product2 = await Product.create({
        title: 'Product 2',
        description: 'Second product same category',
        price: 2000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi',
        status: 'available'
      });
    });

    test('should get related products', async () => {
      const res = await request(app).get(`/api/products/${product1._id}/related`);

      expect(res.status).toBe(200);
      expect(res.body.products.length).toBe(1);
      expect(res.body.products[0].title).toBe('Product 2');
    });
  });

  describe('PUT /api/products/:id/revert-status', () => {
    let pendingProduct;

    beforeEach(async () => {
      pendingProduct = await Product.create({
        title: 'Pending Product',
        description: 'Pending',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi',
        status: 'pending'
      });
    });

    test('should revert pending product to available', async () => {
      const res = await request(app)
        .put(`/api/products/${pendingProduct._id}/revert-status`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.product.status).toBe('available');
    });

    test('should reject revert of available product', async () => {
      const availableProduct = await Product.create({
        title: 'Available Product',
        description: 'Already available',
        price: 1000,
        category: category._id,
        seller: seller._id,
        condition: 'new',
        location: 'Nairobi',
        status: 'available'
      });

      const res = await request(app)
        .put(`/api/products/${availableProduct._id}/revert-status`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(400);
    });
  });
});
