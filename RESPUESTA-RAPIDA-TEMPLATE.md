# 🎯 Respuesta Rápida: Cómo Usar este Proyecto como GitHub Template

**TL;DR**: Haz clic en "Use this template" y sigue los scripts de configuración.

## 🚀 Opción 1: GitHub Web (Recomendado)

1. **Visita**: https://github.com/Grupo-Centaurus/vulcan-nest-api-template
2. **Clic en**: `Use this template` (botón verde)
3. **Configura tu repo**: nombre, descripción, público/privado
4. **Clona y configura**:

```bash
git clone https://github.com/tu-usuario/mi-nueva-api.git
cd mi-nueva-api

# Linux/macOS
chmod +x setup-template.sh
./setup-template.sh

# Windows
setup-template.bat

# Finalizar setup
npm install
docker-compose --profile dev up -d mariadb
npm run prisma:migrate
npm run start:dev
```

## ⚡ Opción 2: GitHub CLI

```bash
gh repo create mi-api --template Grupo-Centaurus/vulcan-nest-api-template
gh repo clone mi-api
cd mi-api
./setup-template.sh
npm install && npm run start:dev
```

## 📖 Documentación Disponible

| 📄 Si necesitas...       | 👀 Lee esto                                                    |
| ------------------------ | -------------------------------------------------------------- |
| Empezar rápido           | [QUICK-START.md](QUICK-START.md)                               |
| Guía completa            | [README.md](README.md)                                         |
| Configurar como template | [docs/GITHUB-TEMPLATE-SETUP.md](docs/GITHUB-TEMPLATE-SETUP.md) |
| Índice de docs           | [docs/README.md](docs/README.md)                               |

## ✅ Lo que obtienes:

- ✅ API NestJS con arquitectura hexagonal
- ✅ Prisma ORM + MariaDB configurado
- ✅ Docker Compose listo
- ✅ VS Code configurado (debugging, tasks, extensiones)
- ✅ AWS Secrets Manager integrado
- ✅ Versionado de API (v1, v2)
- ✅ Health checks
- ✅ Swagger/OpenAPI docs
- ✅ Scripts de configuración automática
- ✅ Documentación completa

## 🎉 Start here:

[![Use this template](https://img.shields.io/badge/Use%20this%20Template-Green?style=for-the-badge&logo=github)](https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate)

_Tu API NestJS lista en 2 minutos_ ⚡
