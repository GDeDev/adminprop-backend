# 🚀 Quick Start Guide

## ⚡ Fastest Way to Run the API

### Option 1: VS Code (Recommended)

1. Open project in VS Code
2. Press `F5` → Select "Debug API (Development)"
3. API starts with hot reload and debugging! 🎉

### Option 2: VS Code Tasks

1. `Ctrl+Shift+P` → "Tasks: Run Task"
2. Select "Start Development Server"
3. API runs with hot reload! 🔥

### Option 3: Terminal

```bash
npm run start:dev
```

## 📋 Prerequisites

✅ **Node.js 18+**  
✅ **npm or yarn**  
✅ **MariaDB/MySQL** (or use Docker)

## 🔧 First-Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run database migrations (needs DB running)
npm run prisma:migrate
```

## 🐳 Quick Database Setup (Docker)

```bash
# Start MariaDB in Docker
docker-compose --profile dev up -d mariadb

# Wait a moment, then run migrations
npm run prisma:migrate
```

## 🌐 API Endpoints

Once running (default: http://localhost:3000):

- **📚 API Docs**: http://localhost:3000/api/docs
- **🏥 Health V1**: http://localhost:3000/api/v1/health
- **🏥 Health V2**: http://localhost:3000/api/v2/health
- **👥 Users V1**: http://localhost:3000/api/v1/users
- **👥 Users V2**: http://localhost:3000/api/v2/users

## 🔍 Debug Tips

- **Breakpoints**: Click line numbers in VS Code
- **Hot Reload**: Changes apply automatically
- **Console**: Check VS Code Debug Console
- **API Docs**: Visit `/api/docs` for interactive testing

## ❓ Need Help?

- 📚 Full documentation: [README.md](../README.md)
- 🔧 VS Code setup: [.vscode/README.md](.vscode/README.md)
- 🔐 Security guide: [docs/ENV-SECURITY-NOTICE.md](../docs/ENV-SECURITY-NOTICE.md)

---

**Happy coding! 🎉**
