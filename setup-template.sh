#!/bin/bash

# 🚀 Vulcan NestJS API Template Setup Script
# This script helps customize the template for your new project

echo "🚀 Welcome to Vulcan NestJS API Template Setup!"
echo ""

# Get project information
read -p "📝 Project name (e.g., my-awesome-api): " PROJECT_NAME
read -p "📝 Project description: " PROJECT_DESCRIPTION
read -p "👨‍💻 Author name: " AUTHOR_NAME
read -p "📧 Author email: " AUTHOR_EMAIL
read -p "🐙 GitHub username: " GITHUB_USERNAME

echo ""
echo "🔧 Customizing template..."

# Replace placeholders in package.json
sed -i "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" package.json
sed -i "s/{{PROJECT_DESCRIPTION}}/$PROJECT_DESCRIPTION/g" package.json
sed -i "s/{{AUTHOR_NAME}}/$AUTHOR_NAME/g" package.json
sed -i "s/{{AUTHOR_EMAIL}}/$AUTHOR_EMAIL/g" package.json
sed -i "s/{{GITHUB_USERNAME}}/$GITHUB_USERNAME/g" package.json

# Update README.md
sed -i "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" README.md
sed -i "s/{{PROJECT_DESCRIPTION}}/$PROJECT_DESCRIPTION/g" README.md

# Copy environment file
cp .env.example .env

echo ""
echo "✅ Template customized successfully!"
echo ""
echo "🔧 Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Configure your .env file with real values"
echo "3. Set up your database"
echo "4. Start development: npm run start:dev"
echo ""
echo "📚 Documentation:"
echo "- Quick Start: ./QUICK-START.md"
echo "- VS Code Setup: ./.vscode/README.md"
echo "- Security Guide: ./docs/ENV-SECURITY-NOTICE.md"
echo ""
echo "🎉 Happy coding!"
