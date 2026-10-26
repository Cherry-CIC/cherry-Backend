# Cherry Backend

Node.js and TypeScript API built with Express and Firebase. Powers the Cherry mobile app with a simple, trustworthy donation checkout flow for pre-loved clothing.

## Features

- Firebase authentication and user management
- Product, category, and charity APIs
- Order management and CSV export
- Stripe payment processing and webhooks
- Sendcloud shipping integration
- Admin operations dashboard

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run start:dev
```

The API runs on `http://localhost:3000` by default.

## API Documentation

Interactive Swagger UI documentation:

- **Local**: http://localhost:3000/api-docs
- **Dev**: https://cherry-backend-401854471349.europe-west2.run.app/api-docs
- **Production**: https://cherry-backend-166746898861.europe-west2.run.app/api-docs

## Environment Configuration

Key environment variables (see `.env.example` for full list):

- Firebase: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Sendcloud: `SENDCLOUD_MODE`, `SENDCLOUD_PUBLIC_KEY`, `SENDCLOUD_SECRET_KEY`
- Email: `EMAIL_MODE`, `RESEND_API_KEY`

**Recommended defaults:**
- `SENDCLOUD_MODE=mock` (use `live` only in production)
- `EMAIL_MODE=off` (unless testing email)
- Keep Stripe in test mode for local development

## Development Commands

```bash
npm run start:dev   # Start development server
npm run build       # Build for production
npm test            # Run tests
```

## Contributing

See `CONTRIBUTING.md` for development workflows and guidelines.
