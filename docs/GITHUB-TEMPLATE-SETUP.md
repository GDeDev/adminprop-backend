# 🔧 Configuración como GitHub Template

Esta guía es para **mantenedores del template** que necesitan configurar el repositorio como GitHub template.

## 🎯 Pasos para Configurar el Template

### 1. Configuración del Repositorio en GitHub

1. **Ve a Settings del repositorio**
2. **En General**, busca la sección **Template repository**
3. **Marca la casilla "Template repository"**
4. **Guarda los cambios**

### 2. Configurar Archivos del Template

#### 2.1 package.json con Placeholders

Asegúrate de que `package.json` contenga placeholders:

```json
{
  "name": "{{PROJECT_NAME}}",
  "version": "0.0.1",
  "description": "{{PROJECT_DESCRIPTION}}",
  "author": "{{AUTHOR_NAME}} <{{AUTHOR_EMAIL}}>",
  "repository": {
    "type": "git",
    "url": "https://github.com/{{GITHUB_USERNAME}}/{{PROJECT_NAME}}.git"
  },
  "bugs": {
    "url": "https://github.com/{{GITHUB_USERNAME}}/{{PROJECT_NAME}}/issues"
  },
  "homepage": "https://github.com/{{GITHUB_USERNAME}}/{{PROJECT_NAME}}#readme"
}
```

#### 2.2 README.md Principal

El README debe incluir botones de template:

```markdown
[![Use this template](https://img.shields.io/badge/Use%20this%20Template-Green?style=for-the-badge&logo=github)](https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate)
```

#### 2.3 Archivos de Entorno

Los archivos `.env.*` deben contener solo valores de ejemplo:

```bash
# ✅ Correcto - valores de plantilla
DATABASE_URL="mysql://user:password@localhost:3306/template_db"
JWT_SECRET="your-jwt-secret-here"

# ❌ Incorrecto - valores reales
DATABASE_URL="mysql://prod_user:real_pass@prod.db.com:3306/real_db"
JWT_SECRET="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Scripts de Configuración

#### 3.1 setup-template.sh (Linux/macOS)

```bash
#!/bin/bash
echo "🚀 Configurando template..."

# Obtener información del usuario
read -p "📝 Project name: " PROJECT_NAME
read -p "📝 Description: " PROJECT_DESCRIPTION
read -p "👨‍💻 Author name: " AUTHOR_NAME
read -p "📧 Author email: " AUTHOR_EMAIL
read -p "🐙 GitHub username: " GITHUB_USERNAME

# Reemplazar placeholders
sed -i "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" package.json
sed -i "s/{{PROJECT_DESCRIPTION}}/$PROJECT_DESCRIPTION/g" package.json
sed -i "s/{{AUTHOR_NAME}}/$AUTHOR_NAME/g" package.json
sed -i "s/{{AUTHOR_EMAIL}}/$AUTHOR_EMAIL/g" package.json
sed -i "s/{{GITHUB_USERNAME}}/$GITHUB_USERNAME/g" package.json

echo "✅ Template configurado!"
```

#### 3.2 setup-template.bat (Windows)

```batch
@echo off
echo 🚀 Configurando template...

set /p PROJECT_NAME="📝 Project name: "
set /p PROJECT_DESCRIPTION="📝 Description: "
set /p AUTHOR_NAME="👨‍💻 Author name: "
set /p AUTHOR_EMAIL="📧 Author email: "
set /p GITHUB_USERNAME="🐙 GitHub username: "

powershell -Command "(gc package.json) -replace '{{PROJECT_NAME}}', '%PROJECT_NAME%' | Out-File -encoding ASCII package.json"

echo ✅ Template configurado!
```

### 4. Documentación del Template

#### 4.1 Archivos Requeridos

- ✅ `README.md` - Documentación principal con botones de template
- ✅ `README.md` - Guía detallada de uso
- ✅ `QUICK-START.md` - Inicio rápido
- ✅ `.env.example` - Variables de entorno de ejemplo
- ✅ `setup-template.sh` - Script de configuración Linux/macOS
- ✅ `setup-template.bat` - Script de configuración Windows

#### 4.2 Estructura de Documentación

```
docs/
├── 📄 AUTH.md                  # Autenticación
├── 📄 CONFIGURATION.md         # Entorno, config tipada y secretos
├── 📄 ERROR-HANDLING.md        # Formato de errores y códigos
├── 📄 RATE-LIMITING.md         # Throttling
└── 📄 ENV-SECURITY-NOTICE.md   # Seguridad de variables
```

### 5. Configuración de .gitignore

El `.gitignore` debe permitir archivos de configuración pero excluir secrets:

```gitignore
# Environment files (allow examples)
.env
.env.local
.env.*.local

# Allow .env.example files
!.env.example
!.env.qa
!.env.production

# VS Code (allow configuration)
!.vscode/
.vscode/settings.local.json

# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/

# Testing
coverage/

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Optional npm cache directory
.npm

# Database
*.db
*.sqlite
```

### 6. Badges y Links del Template

#### 6.1 Badges Recomendados

```markdown
[![GitHub Template](https://img.shields.io/badge/GitHub-Template-green?logo=github)](https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10.0+-red?logo=nestjs)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-Latest-purple?logo=prisma)](https://prisma.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://docker.com/)
```

#### 6.2 Botón de Uso del Template

```markdown
[![Use this template](https://img.shields.io/badge/Use%20this%20Template-Green?style=for-the-badge&logo=github)](https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate)
```

### 7. Configuración de VS Code

#### 7.1 Archivos de Configuración

- ✅ `.vscode/tasks.json` - Tareas automatizadas
- ✅ `.vscode/launch.json` - Configuración de debugging
- ✅ `.vscode/settings.json` - Configuración del workspace
- ✅ `.vscode/extensions.json` - Extensiones recomendadas

#### 7.2 Extensiones Recomendadas

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-json",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint",
    "prisma.prisma",
    "ms-vscode.vscode-docker"
  ]
}
```

### 8. Testing del Template

#### 8.1 Checklist de Verificación

- ✅ El botón "Use this template" funciona
- ✅ Los scripts de configuración funcionan
- ✅ Los placeholders se reemplazan correctamente
- ✅ La documentación está actualizada
- ✅ Los archivos de entorno contienen solo ejemplos
- ✅ Las dependencias se instalan sin errores
- ✅ La aplicación inicia correctamente
- ✅ Los endpoints responden correctamente

#### 8.2 Proceso de Testing

1. **Crear un repositorio de prueba:**

   ```bash
   # Usar el template para crear un nuevo repo
   # Verificar que todo funciona
   ```

2. **Ejecutar scripts de configuración:**

   ```bash
   ./setup-template.sh
   npm install
   npm run start:dev
   ```

3. **Verificar endpoints:**
   ```bash
   curl http://localhost:3000/api/v1/health
   curl http://localhost:3000/api/v2/health
   ```

### 9. Mantenimiento del Template

#### 9.1 Actualizaciones Regulares

- 🔄 **Dependencias**: Mantener packages actualizados
- 📚 **Documentación**: Revisar y actualizar guías
- 🔐 **Seguridad**: Verificar que no hay secrets expuestos
- 🧪 **Testing**: Verificar que el template funciona

#### 9.2 Versioning del Template

```bash
# Crear tags para versiones del template
git tag -a v1.0.0 -m "Vulcan NestJS Template v1.0.0"
git push origin v1.0.0
```

### 10. URLs y Links Importantes

#### 10.1 Para Incluir en Documentación

```markdown
- **Template Repository**: https://github.com/Grupo-Centaurus/vulcan-nest-api-template
- **Use Template**: https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate
- **Issues**: https://github.com/Grupo-Centaurus/vulcan-nest-api-template/issues
- **Documentation**: https://github.com/Grupo-Centaurus/vulcan-nest-api-template/tree/main/docs
```

---

## ✅ Checklist Final

Antes de publicar el template, verificar:

- [ ] Repositorio marcado como "Template repository" en GitHub
- [ ] README.md con botones y enlaces de template
- [ ] package.json con placeholders correctos
- [ ] Scripts de configuración funcionando
- [ ] Archivos .env con solo valores de ejemplo
- [ ] Documentación completa y actualizada
- [ ] .gitignore configurado correctamente
- [ ] VS Code configurado con extensiones
- [ ] Testing completo realizado
- [ ] No hay secrets reales expuestos

---

**Template listo para uso! 🚀**
