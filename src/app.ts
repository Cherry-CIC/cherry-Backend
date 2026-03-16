import express from 'express';
import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config({ path: '.env' });

import swaggerUi from 'swagger-ui-express';
import { swaggerSpecs } from './shared/config/swaggerConfig';

// Initialize Firebase
import './shared/config/firebaseConfig';

const app = express();
app.use(express.json());

import productRoutes from './modules/products/routes/productRoutes';
import categoryRoutes from './modules/categories/routes/categoryRoutes';
import charityRoutes from './modules/charities/routes/charityRoutes';
import authRoutes from './modules/auth/routes/authRoutes';
import paymentRoutes from './modules/payment/routes/paymentRoutes';
import orderRoutes from './modules/order/routes/orderRoutes';
import adminRoutes from './modules/order/routes/adminRoutes';
import shippingRoutes from './modules/shipping/routes/shippingRoutes';

app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/charities', charityRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shipping', shippingRoutes);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl
    });
});

export default app;
