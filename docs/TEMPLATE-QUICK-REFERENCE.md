# 🚀 Guía Rápida: Usar como GitHub Template

## 📖 Resumen de Documentación

Este repositorio incluye documentación completa para usar el template:

| 📄 Archivo                                                         | 🎯 Propósito                      | 👤 Para quién             |
| ------------------------------------------------------------------ | --------------------------------- | ------------------------- |
| **[README.md](../README.md)**                                      | 📖 Arranque, estructura y scripts | Todos los desarrolladores |
| **[docs/README.md](README.md)**                                    | 📚 Índice de la documentación     | Todos los desarrolladores |
| **[QUICK-START.md](QUICK-START.md)**                               | ⚡ Inicio súper rápido en VS Code | Desarrollo local          |
| **[docs/GITHUB-TEMPLATE-SETUP.md](docs/GITHUB-TEMPLATE-SETUP.md)** | 🔧 Configuración del template     | Mantenedores              |

## 🎯 3 Formas de Usar Este Template

### 1. 🌐 **GitHub Web (Más Fácil)**

```
1. Ir a: https://github.com/Grupo-Centaurus/vulcan-nest-api-template
2. Clic en "Use this template" (botón verde)
3. Configurar nuevo repositorio
4. Clonar y configurar con scripts
```

### 2. 💻 **GitHub CLI**

```bash
gh repo create mi-api --template Grupo-Centaurus/vulcan-nest-api-template
gh repo clone mi-api
cd mi-api
./setup-template.sh  # Linux/macOS
# setup-template.bat # Windows
```

### 3. 🔄 **Fork + Customización Manual**

```bash
git clone https://github.com/Grupo-Centaurus/vulcan-nest-api-template.git mi-api
cd mi-api
# Editar package.json manualmente
# Configurar .env
# npm install && npm run start:dev
```

## ⚡ Configuración Express (30 segundos)

```bash
# 1. Crear desde template en GitHub (web)
# 2. Clonar
git clone https://github.com/tu-usuario/mi-nueva-api.git
cd mi-nueva-api

# 3. Auto-configurar
./setup-template.sh  # Te pide: nombre, descripción, autor

# 4. Instalar y ejecutar
npm install
docker-compose --profile dev up -d mariadb
npm run prisma:migrate
npm run start:dev

# ✅ API corriendo en http://localhost:3000
```

## 🛠️ Para Mantenedores

Si necesitas configurar este repo como template GitHub:

1. **Configurar repo:**

   - Settings → Template repository ✅

2. **Verificar archivos:**

   - `package.json` con placeholders `{{PROJECT_NAME}}`
   - Scripts `setup-template.*` funcionando
   - `.env.*` solo con valores de ejemplo
   - Documentación actualizada

3. **Testing:**
   - Crear repo de prueba usando template
   - Verificar que scripts funcionan
   - Confirmar que la app inicia correctamente

📚 **Guía completa**: [docs/GITHUB-TEMPLATE-SETUP.md](docs/GITHUB-TEMPLATE-SETUP.md)

## 🎉 ¡Empieza Tu Proyecto!

**¿Listo para crear tu API?**

[![Use this template](https://img.shields.io/badge/Use%20this%20Template-Green?style=for-the-badge&logo=github)](https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate)

---

_Tu nueva API NestJS lista en menos de 2 minutos_ ⚡
