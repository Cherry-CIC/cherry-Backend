import express from 'express';
import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config({ path: '.env' });

import swaggerUi from 'swagger-ui-express';
import { swaggerSpecs } from './shared/config/swaggerConfig';
import { stripeWebhook } from './modules/payment/controllers/paymentController';

// Initialize Firebase
import './shared/config/firebaseConfig';

const app = express();

const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
        res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
        return;
    }
    next();
});

app.post(
    '/api/payment/webhook',
    express.raw({ type: 'application/json' }),
    stripeWebhook,
);
app.use(express.json({
    verify: (req, res, buffer) => {
        (req as any).rawBody = Buffer.from(buffer);
    },
}));
import productRoutes from './modules/products/routes/productRoutes';
import categoryRoutes from './modules/categories/routes/categoryRoutes';
import charityRoutes from './modules/charities/routes/charityRoutes';
import authRoutes from './modules/auth/routes/authRoutes';
import userRoutes from './modules/users/routes/userRoutes';
import paymentRoutes from './modules/payment/routes/paymentRoutes';
import orderRoutes from './modules/order/routes/orderRoutes';
import adminRoutes from './modules/order/routes/adminRoutes';
import shippingRoutes from './modules/shipping/routes/shippingRoutes';
import postageSizeRoutes from './modules/postage-sizes/routes/postageSizeRoutes';
import notificationRoutes from './modules/notifications/routes/notificationRoutes';
import reportRoutes from './modules/reports/routes/reportRoutes';
import blockRoutes from './modules/blocks/routes/blockRoutes';

app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/charities', charityRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/postage-sizes', postageSizeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/blocks', blockRoutes);

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
