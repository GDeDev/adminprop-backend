# Template Repository Configuration

Este repositorio está configurado como GitHub Template para crear nuevas APIs con NestJS.

## 📋 Template Information

- **Name**: Vulcan - NestJS Hexagonal Architecture API Template
- **Organization**: Grupo Centaurus
- **Description**: Enterprise-grade NestJS API with hexagonal architecture, CQRS, Prisma ORM, MariaDB, AWS integration
- **Repository**: https://github.com/Grupo-Centaurus/vulcan-nest-api-template
- **Language**: TypeScript
- **Framework**: NestJS
- **Architecture**: Hexagonal + CQRS
- **Database**: MariaDB with Prisma ORM
- **Cloud**: AWS Ready (Secrets Manager, ECS, Lambda)

## 🎯 What's Included

### Core Features

- ✅ Hexagonal Architecture (Clean Architecture)
- ✅ CQRS Pattern (Command Query Responsibility Segregation)
- ✅ Result Pattern for consistent error handling
- ✅ Domain-Driven Design structure
- ✅ Dependency Injection with NestJS

### Database & ORM

- ✅ MariaDB integration
- ✅ Prisma ORM with type safety
- ✅ Database migrations
- ✅ Connection pooling
- ✅ Query optimization

### API Features

- ✅ RESTful API with versioning
- ✅ Swagger/OpenAPI documentation
- ✅ Input validation with class-validator
- ✅ Request/Response transformation
- ✅ Global exception handling
- ✅ Request logging and monitoring

### Security & Configuration

- ✅ AWS Secrets Manager integration
- ✅ Environment-based configuration
- ✅ CORS configuration
- ✅ Rate limiting ready
- ✅ JWT authentication structure

### Development Experience

- ✅ Hot reload for development
- ✅ VS Code integration (tasks, debugging, extensions)
- ✅ TypeScript with strict configuration
- ✅ ESLint + Prettier + Husky
- ✅ Pre-commit hooks for code quality

### Testing

- ✅ Unit tests with Jest
- ✅ Integration tests setup
- ✅ E2E tests configuration
- ✅ Coverage reporting (HTML, LCOV)
- ✅ Test debugging in VS Code

### DevOps & Deployment

- ✅ Docker configuration (dev + production)
- ✅ Docker Compose for local development
- ✅ GitHub Actions CI/CD
- ✅ Multi-stage Docker builds
- ✅ Health checks and monitoring

### Documentation

- ✅ Comprehensive setup instructions
- ✅ Architecture documentation
- ✅ API documentation with Swagger
- ✅ Development guides
- ✅ Deployment guides

## 🚀 Quick Start for Template Users

### Option 1: Use Template Button (Recommended)

1. Click "Use this template" button
2. Create your new repository
3. Clone your new repository
4. Run `./scripts/init-template.sh` (Linux/Mac) or `scripts\init-template.bat` (Windows)
5. Follow the prompts to configure your project

### Option 2: Manual Setup

1. Download or clone this repository
2. Update `package.json` with your project details
3. Copy `.env.example` to `.env` and configure
4. Update `README.md` with your project information
5. Follow setup instructions in `README.md`

## 📁 Project Structure

```
├── src/
│   ├── application/          # Application layer (CQRS)
│   │   ├── commands/        # Command definitions
│   │   ├── queries/         # Query definitions
│   │   └── handlers/        # Command/query handlers
│   ├── domain/              # Domain layer
│   │   ├── entities/        # Domain entities
│   │   └── repositories/    # Repository abstractions
│   ├── infrastructure/      # Infrastructure layer
│   │   ├── repositories/    # Repository implementations
│   │   ├── services/        # External services
│   │   └── config/          # Configuration
│   ├── presentation/        # Presentation layer
│   │   ├── controllers/     # REST controllers
│   │   └── dto/            # Data transfer objects
│   └── common/             # Shared utilities
├── test/                   # Test files
├── docs/                   # Documentation
├── scripts/               # Utility scripts
├── .github/               # GitHub workflows
├── .vscode/               # VS Code configuration
└── docker/                # Docker configurations
```

## 🛠️ Technologies & Dependencies

### Core

- **NestJS** - Progressive Node.js framework
- **TypeScript** - Type-safe JavaScript
- **Prisma** - Next-generation ORM
- **MariaDB** - Reliable relational database

### Development

- **Jest** - Testing framework
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Husky** - Git hooks
- **Docker** - Containerization

### Production

- **AWS SDK** - Cloud integration
- **class-validator** - Input validation
- **Swagger** - API documentation
- **Helmet** - Security headers

## 📖 Documentation

- 📖 `README.md` - Setup, structure and scripts
- 📖 `docs/AUTH.md` - Authentication
- 📖 `docs/CONFIGURATION.md` - Environment and secrets
- 📖 `docs/DEBUGGING.md` - Debugging guide
- 📖 `docs/VSCODE-SETUP.md` - VS Code configuration
- 📖 `docs/FORMATTING.md` - Code formatting guide

## 🔄 Template Updates

This template is actively maintained. To get updates:

1. **For new projects**: Use the latest version of the template
2. **For existing projects**: Check releases for new features and security updates
3. **Contributing**: Submit PRs for improvements and bug fixes

## 📞 Support

- 📝 **Issues**: Report bugs and request features
- 💬 **Discussions**: Ask questions and share ideas
- 📧 **Contact**: Reach out to maintainers
- 📚 **Wiki**: Extended documentation and examples

## 📄 License

This template is provided under the MIT License. See `LICENSE` file for details.

---

**Happy coding! 🚀**
