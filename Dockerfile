FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm install --only=production

# Copy source code
COPY . .

# Install dev dependencies and build
RUN npm install && npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Set production environment
ENV NODE_ENV=production

# Expose Cloud Run port
EXPOSE 8080

# Run the compiled code
CMD ["npm", "start"]