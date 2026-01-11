#!/bin/bash

echo "🎨 E-Paper Image Optimizer - Quick Start"
echo "========================================"
echo ""

# Check if example.png exists
if [ ! -f "example.png" ]; then
    echo "📸 No example.png found. Creating one..."
    echo "ℹ️  Note: This will be created inside Docker container"
    echo ""
fi

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "🐳 Building and starting Docker container..."
docker compose up --build -d

echo ""
echo "⏳ Waiting for server to be ready..."
sleep 3

# Check if server is responding
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Server is running!"
    echo ""
    echo "🌐 Available endpoints:"
    echo "   • API Info:        http://localhost:3000/"
    echo "   • Optimized PNG:   http://localhost:3000/png"
    echo "   • Optimized BMP:   http://localhost:3000/bmp"
    echo "   • ESP32 BMP (raw): http://localhost:3000/esp32/image"
    echo "   • Upload UI:       http://localhost:3000/upload"
    echo "   • Health Check:    http://localhost:3000/health"
    echo ""
    echo "📥 Test it with:"
    echo "   curl http://localhost:3000/bmp -o optimized.bmp"
    echo ""
    echo "📊 View logs:"
    echo "   docker compose logs -f"
    echo ""
    echo "🛑 Stop server:"
    echo "   docker compose down"
else
    echo "⚠️  Server might still be starting. Check logs with:"
    echo "   docker compose logs -f"
fi
