FROM node:20-alpine

# Install dependencies for canvas (node-canvas requires Cairo and other system libraries)
RUN apk add --no-cache \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    build-base \
    g++ \
    make \
    python3

WORKDIR /app

# Copy package files for the main project (needed for building TypeScript)
COPY package*.json ./
COPY vite.config.js ./

# Copy source files needed for build
COPY src/ ./src/

# Install dependencies and build TypeScript
RUN npm install && npm run build

# Copy server package files
COPY server/package*.json ./server/

# Install server dependencies
RUN cd server && npm install

# Copy server application code
COPY server/ ./server/

# Copy example image
COPY examples/example.png ./server/example.png

# Make entrypoint executable
RUN chmod +x /app/server/entrypoint.sh

# Create a directory for images
RUN mkdir -p /app/server/images

# Set working directory to server
WORKDIR /app/server

# Expose the port
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV IMAGE_PATH=/app/server/example.png
ENV DEVICE_TYPE=spectra6

# Use entrypoint script to create example image if needed and start server
ENTRYPOINT ["/app/server/entrypoint.sh"]
