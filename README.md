# Cherry Backend

A Node.js/TypeScript backend API built with Express.js and Firebase to power the Cherry Mobile App: [https://github.com/Cherry-CIC/MVP](https://github.com/Cherry-CIC/MVP)

## 🏗️ Project Structure

```
src/
├── app.ts                    # Express application setup
├── server.ts                 # Server entry point
├── modules/                  # Feature modules
│   ├── auth/                # Authentication module
│   │   ├── controllers/     # Auth controllers
│   │   ├── model/           # User model
│   │   ├── repositories/    # User repository
│   │   ├── routes/          # Auth routes
│   │   └── validators/      # Auth validation
│   ├── products/            # Product management
│   ├── categories/          # Category management
│   └── charities/           # Charity management
├── shared/                   # Shared utilities
│   ├── config/              # Configuration files
│   ├── middleware/          # Custom middleware
│   └── utils/               # Utility functions
└── types/                    # TypeScript type definitions
```

## 🛠️ Prerequisites

Before running this project, make sure you have:

- **Node.js** (v20 or higher)
- **npm** or **yarn**
- **Firebase CLI** (optional, for local emulation)

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd cherry-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

We use environment variables for configuration. To get started locally:

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. For local development, the default values in `.env.example` are designed to work with the **Firebase Emulator**. You do not need real production keys to start developing.

### 4. Running the Firebase Emulator (Recommended)

To avoid needing real Firebase credentials and to prevent "Login Failed" issues caused by SHA-1 mismatches:

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login to Firebase (once): `firebase login`
3. Start the emulators:
   ```bash
   firebase emulators:start
   ```
4. Ensure your `.env` has the following (uncommented):
   ```env
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   ```

## 🏃‍♂️ Running the Backend

### Development Mode

```bash
npm run start:dev
```

The server will start on `http://localhost:4000` (or your configured PORT).

### Production Mode

```bash
# Build the project
npm run build

# Start the production server
npm start
```

### Using Docker

```bash
# Build the Docker image
docker build -t cherry-backend .

# Run the container
docker run -p 4000:8080 cherry-backend
```

## 📖 API Documentation

Once the server is running, you can access the API documentation at:

```
http://localhost:4000/api-docs
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the Repository**
2. **Create a Feature Branch**: `git checkout -b feature/your-feature-name`
3. **Follow Conventional Commits**: e.g., `feat: add apple sign-in support`
4. **Local Testing**: Ensure you test against the Firebase Emulator before submitting.

### Security Note
**Never** commit `.env` files or real Firebase service account JSONs to the repository. Always use `.env.example` as a template for new configuration keys.
