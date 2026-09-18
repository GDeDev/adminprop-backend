@echo off
setlocal enabledelayedexpansion

REM 🚀 NestJS API Template Initialization Script for Windows
REM This script helps you configure the template for your new project

echo 🎯 NestJS API Template - Configuración Inicial
echo ==============================================
echo.

echo 🔵 Vamos a configurar tu nuevo proyecto API.
echo.

REM Function to prompt for input
set /p PROJECT_NAME="Nombre del proyecto (sin espacios) [my-api]: "
if "!PROJECT_NAME!"=="" set PROJECT_NAME=my-api

set /p PROJECT_DESCRIPTION="Descripción del proyecto [API built with NestJS template]: "
if "!PROJECT_DESCRIPTION!"=="" set PROJECT_DESCRIPTION=API built with NestJS template

set /p AUTHOR_NAME="Nombre del autor [Your Name]: "
if "!AUTHOR_NAME!"=="" set AUTHOR_NAME=Your Name

set /p AUTHOR_EMAIL="Email del autor [your.email@example.com]: "
if "!AUTHOR_EMAIL!"=="" set AUTHOR_EMAIL=your.email@example.com

set /p GITHUB_USERNAME="Tu username de GitHub []: "

set /p DATABASE_NAME="Nombre de la base de datos [%PROJECT_NAME:_=-_db%]: "
if "!DATABASE_NAME!"=="" set DATABASE_NAME=%PROJECT_NAME:_=-_db%

echo.
echo 🟡 Configurando proyecto...

REM Update package.json
if exist "package.json" (
    echo 📦 Actualizando package.json...
    powershell -Command "(gc package.json) -replace '{{PROJECT_NAME}}', '%PROJECT_NAME%' | Out-File -encoding UTF8 package.json"
    powershell -Command "(gc package.json) -replace '{{PROJECT_DESCRIPTION}}', '%PROJECT_DESCRIPTION%' | Out-File -encoding UTF8 package.json"
    powershell -Command "(gc package.json) -replace '{{AUTHOR_NAME}}', '%AUTHOR_NAME%' | Out-File -encoding UTF8 package.json"
    powershell -Command "(gc package.json) -replace '{{AUTHOR_EMAIL}}', '%AUTHOR_EMAIL%' | Out-File -encoding UTF8 package.json"
    powershell -Command "(gc package.json) -replace '{{GITHUB_USERNAME}}', '%GITHUB_USERNAME%' | Out-File -encoding UTF8 package.json"
)

REM Update .env.example
if exist ".env.example" (
    echo 🔧 Actualizando .env.example...
    powershell -Command "(gc .env.example) -replace 'DATABASE_URL=\"mysql://root:password@localhost:3306/nest_api\"', 'DATABASE_URL=\"mysql://root:password@localhost:3306/%DATABASE_NAME%\"' | Out-File -encoding UTF8 .env.example"
)

REM Update docker-compose.yml
if exist "docker-compose.yml" (
    echo 🐳 Actualizando docker-compose.yml...
    powershell -Command "(gc docker-compose.yml) -replace 'MYSQL_DATABASE: nest_api', 'MYSQL_DATABASE: %DATABASE_NAME%' | Out-File -encoding UTF8 docker-compose.yml"
)

REM Update README.md
if exist "README.md" (
    echo 📖 Actualizando README.md...
    powershell -Command "(gc README.md) -replace '# NestJS API Template', '# %PROJECT_NAME%' | Out-File -encoding UTF8 README.md"
    powershell -Command "(gc README.md) -replace 'A comprehensive NestJS API template', '%PROJECT_DESCRIPTION%' | Out-File -encoding UTF8 README.md"
    
    if not "!GITHUB_USERNAME!"=="" (
        powershell -Command "(gc README.md) -replace 'git clone <repository-url>', 'git clone https://github.com/%GITHUB_USERNAME%/%PROJECT_NAME%.git' | Out-File -encoding UTF8 README.md"
        powershell -Command "(gc README.md) -replace 'cd nestjs-api-template', 'cd %PROJECT_NAME%' | Out-File -encoding UTF8 README.md"
    )
)

REM Create .env from .env.example
if exist ".env.example" (
    if not exist ".env" (
        echo 📝 Creando archivo .env...
        copy ".env.example" ".env" >nul
        
        REM Generate JWT secret (simple version for Windows)
        set JWT_SECRET=your-super-secret-jwt-key-here-please-change-this-in-production
        powershell -Command "(gc .env) -replace 'JWT_SECRET=your_jwt_secret_here', 'JWT_SECRET=%JWT_SECRET%' | Out-File -encoding UTF8 .env"
    )
)

REM Update Prisma schema
if exist "prisma\schema.prisma" (
    echo 🗃️  Actualizando Prisma schema...
    powershell -Command "(gc prisma\schema.prisma) -replace 'generator client {', '// Database: %DATABASE_NAME%`ngenerator client {' | Out-File -encoding UTF8 prisma\schema.prisma"
)

echo.
echo ✅ Configuración completada!
echo.
echo 🔵 Próximos pasos:
echo.
echo 1. 📦 Instalar dependencias:
echo    npm install
echo.
echo 2. 🐳 Iniciar base de datos:
echo    npm run docker:dev
echo.
echo 3. 🗃️  Configurar Prisma:
echo    npm run prisma:generate
echo.
echo 4. 🚀 Ejecutar API:
echo    npm run start:dev
echo.
echo 5. 🧪 Ejecutar tests:
echo    npm test
echo.
echo 🟢 Tu API estará disponible en: http://localhost:3000
echo 🟢 Documentación Swagger: http://localhost:3000/swagger
echo.
echo 🔵 📚 Para más información, lee:
echo    📖 docs\TEMPLATE-USAGE.md - Manual completo
echo    📖 docs\DEBUGGING.md - Guía de debugging
echo    📖 docs\VSCODE-SETUP.md - Configuración VS Code
echo.

if exist ".git" (
    echo 🟡 💡 Sugerencia: Haz commit de los cambios
    echo    git add .
    echo    git commit -m "chore: configure project from template"
    echo.
)

echo 🎉 ¡Disfruta construyendo tu API!
pause
