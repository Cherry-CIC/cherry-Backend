# cherry Backend

A Node.js/TypeScript cherry backend API Built with Express.js and Firebase to power the Cherry Mobile App: https://github.com/Cherry-CIC/MVP

```
src/
├── app.ts                    # Express application setup
├── server.ts                # Server entry point
├── modules/                 # Feature modules
│   ├── auth/               # Authentication module
│   │   ├── controllers/    # Auth controllers
│   │   ├── model/         # User model
│   │   ├── repositories/  # User repository
│   │   ├── routes/        # Auth routes
│   │   └── validators/    # Auth validation
│   ├── products/          # Product management
│   ├── categories/        # Category management
│   └── charities/         # Charity management
├── shared/                # Shared utilities
│   ├── config/           # Configuration files
│   ├── middleware/       # Custom middleware
│   └── utils/           # Utility functions
└── types/               # TypeScript type definitions
```

## 🛠️ Prerequisites

Before running this project, make sure you have:

- **Node.js** (v20 or higher)
- **npm** or **yarn**

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

Create your environment files:

```bash
cp .env.development .env.productiom
```

Update the environment variables (reach out to cherry mgmt):

```env
PORT=4000

# Firebase Configuration
FIREBASE_API_KEY=your-firebase-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-app-id
FIREBASE_MEASUREMENT_ID=your-measurement-id
```

## 🏃‍♂️ Running the Project

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

## 🔧 Development Tools

### Code Formatting

```bash
# Format code with Prettier
npm run format

# Lint code with ESLint
npm run lint
```

### Build

```bash
# Compile TypeScript to JavaScript
npm run build
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

### 1. Fork the Repository

Click the "Fork" button on the repository page to create your own copy.

### 2. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 3. Make Your Changes

- Follow the existing code style and patterns
- Add tests for new functionality
- Update documentation if needed
- Ensure all tests pass

### 4. Code Quality Checks

Before submitting, run:

```bash
# Format your code
npm run format

# Fix linting issues
npm run lint

# Run tests
npm test

# Build the project
npm run build
```

### 5. Commit Your Changes

```bash
git add .
git commit -m "feat: add your feature description"
```

Follow [Conventional Commits](https://www.conventionalcommits.org/) format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `test:` for adding tests
- `refactor:` for code refactoring

### 6. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 7. Create a Pull Request

1. Go to the original repository
2. Click "New Pull Request"
3. Select your branch
4. Fill in the PR template with:
   - Description of changes
   - Type of change (feature, bugfix, etc.)
   - Testing performed
   - Screenshots (if applicable)

### Development Guidelines

- **Code Style**: Follow the existing conventions and architecture
- **Documentation**: Update README and API docs for significant changes
- **Types**: Maintain strong typing throughout the codebase
- **Error Handling**: Use proper error handling and validation

### Project Structure Guidelines

- **Modules**: Keep related functionality in dedicated modules
- **Controllers**: Handle HTTP requests and responses
- **Repositories**: Manage data access and storage
- **Models**: Define data structures and interfaces
- **Validators**: Implement input validation using Joi
- **Routes**: Define API endpoints and middleware

