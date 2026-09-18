#!/bin/bash

# 🚀 NestJS API Template Initialization Script
# This script helps you configure the template for your new project

set -e

echo "🎯 NestJS API Template - Configuración Inicial"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to prompt for input
prompt() {
    local prompt_text="$1"
    local default_value="$2"
    local user_input
    
    if [ -n "$default_value" ]; then
        read -p "$prompt_text [$default_value]: " user_input
        echo "${user_input:-$default_value}"
    else
        read -p "$prompt_text: " user_input
        echo "$user_input"
    fi
}

# Function to replace text in files
replace_in_file() {
    local file="$1"
    local search="$2"
    local replace="$3"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|$search|$replace|g" "$file"
    else
        # Linux
        sed -i "s|$search|$replace|g" "$file"
    fi
}

echo -e "${BLUE}Vamos a configurar tu nuevo proyecto API.${NC}"
echo ""

# Collect project information
PROJECT_NAME=$(prompt "Nombre del proyecto (sin espacios)" "my-api")
PROJECT_DESCRIPTION=$(prompt "Descripción del proyecto" "API built with NestJS template")
AUTHOR_NAME=$(prompt "Nombre del autor" "Your Name")
AUTHOR_EMAIL=$(prompt "Email del autor" "your.email@example.com")
GITHUB_USERNAME=$(prompt "Tu username de GitHub" "")
DATABASE_NAME=$(prompt "Nombre de la base de datos" "${PROJECT_NAME//-/_}_db")

echo ""
echo -e "${YELLOW}Configurando proyecto...${NC}"

# Update package.json
if [ -f "package.json" ]; then
    echo "📦 Actualizando package.json..."
    replace_in_file "package.json" '{{PROJECT_NAME}}' "$PROJECT_NAME"
    replace_in_file "package.json" '{{PROJECT_DESCRIPTION}}' "$PROJECT_DESCRIPTION"
    replace_in_file "package.json" '{{AUTHOR_NAME}}' "$AUTHOR_NAME"
    replace_in_file "package.json" '{{AUTHOR_EMAIL}}' "$AUTHOR_EMAIL"
    replace_in_file "package.json" '{{GITHUB_USERNAME}}' "$GITHUB_USERNAME"
fi

# Update .env.example
if [ -f ".env.example" ]; then
    echo "🔧 Actualizando .env.example..."
    replace_in_file ".env.example" 'DATABASE_URL="mysql://root:password@localhost:3306/nest_api"' "DATABASE_URL=\"mysql://root:password@localhost:3306/$DATABASE_NAME\""
fi

# Update docker-compose.yml
if [ -f "docker-compose.yml" ]; then
    echo "🐳 Actualizando docker-compose.yml..."
    replace_in_file "docker-compose.yml" 'MYSQL_DATABASE: nest_api' "MYSQL_DATABASE: $DATABASE_NAME"
fi

# Update README.md
if [ -f "README.md" ]; then
    echo "📖 Actualizando README.md..."
    replace_in_file "README.md" '# NestJS API Template' "# $PROJECT_NAME"
    replace_in_file "README.md" 'A comprehensive NestJS API template' "$PROJECT_DESCRIPTION"
    
    if [ -n "$GITHUB_USERNAME" ]; then
        replace_in_file "README.md" 'git clone <repository-url>' "git clone https://github.com/$GITHUB_USERNAME/$PROJECT_NAME.git"
        replace_in_file "README.md" 'cd nestjs-api-template' "cd $PROJECT_NAME"
    fi
fi

# Create .env from .env.example
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "📝 Creando archivo .env..."
    cp .env.example .env
    
    # Generate JWT secret
    JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "your-super-secret-jwt-key-here")
    replace_in_file ".env" 'JWT_SECRET=your_jwt_secret_here' "JWT_SECRET=$JWT_SECRET"
fi

# Update Prisma schema
if [ -f "prisma/schema.prisma" ]; then
    echo "🗃️  Actualizando Prisma schema..."
    replace_in_file "prisma/schema.prisma" 'generator client {' "// Database: $DATABASE_NAME\ngenerator client {"
fi

echo ""
echo -e "${GREEN}✅ Configuración completada!${NC}"
echo ""
echo -e "${BLUE}Próximos pasos:${NC}"
echo ""
echo "1. 📦 Instalar dependencias:"
echo -e "   ${YELLOW}npm install${NC}"
echo ""
echo "2. 🐳 Iniciar base de datos:"
echo -e "   ${YELLOW}npm run docker:dev${NC}"
echo ""
echo "3. 🗃️  Configurar Prisma:"
echo -e "   ${YELLOW}npm run prisma:generate${NC}"
echo ""
echo "4. 🚀 Ejecutar API:"
echo -e "   ${YELLOW}npm run start:dev${NC}"
echo ""
echo "5. 🧪 Ejecutar tests:"
echo -e "   ${YELLOW}npm test${NC}"
echo ""
echo -e "${GREEN}Tu API estará disponible en: http://localhost:3000${NC}"
echo -e "${GREEN}Documentación Swagger: http://localhost:3000/swagger${NC}"
echo ""
echo -e "${BLUE}📚 Para más información, lee:${NC}"
echo -e "   📖 ${YELLOW}docs/TEMPLATE-USAGE.md${NC} - Manual completo"
echo -e "   📖 ${YELLOW}docs/DEBUGGING.md${NC} - Guía de debugging"
echo -e "   📖 ${YELLOW}docs/VSCODE-SETUP.md${NC} - Configuración VS Code"
echo ""

# Check if this is a git repository
if [ -d ".git" ]; then
    echo -e "${YELLOW}💡 Sugerencia: Haz commit de los cambios${NC}"
    echo -e "   ${YELLOW}git add .${NC}"
    echo -e "   ${YELLOW}git commit -m \"chore: configure project from template\"${NC}"
    echo ""
fi

echo -e "${GREEN}🎉 ¡Disfruta construyendo tu API!${NC}"
