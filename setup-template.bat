@echo off
REM 🚀 Vulcan NestJS API Template Setup Script (Windows)
REM This script helps customize the template for your new project

echo 🚀 Welcome to Vulcan NestJS API Template Setup!
echo.

REM Get project information
set /p PROJECT_NAME="📝 Project name (e.g., my-awesome-api): "
set /p PROJECT_DESCRIPTION="📝 Project description: "
set /p AUTHOR_NAME="👨‍💻 Author name: "
set /p AUTHOR_EMAIL="📧 Author email: "
set /p GITHUB_USERNAME="🐙 GitHub username: "

echo.
echo 🔧 Customizing template...

REM Replace placeholders in package.json (Windows doesn't have sed, so we'll use PowerShell)
powershell -Command "(Get-Content package.json) -replace '{{PROJECT_NAME}}', '%PROJECT_NAME%' | Set-Content package.json"
powershell -Command "(Get-Content package.json) -replace '{{PROJECT_DESCRIPTION}}', '%PROJECT_DESCRIPTION%' | Set-Content package.json"
powershell -Command "(Get-Content package.json) -replace '{{AUTHOR_NAME}}', '%AUTHOR_NAME%' | Set-Content package.json"
powershell -Command "(Get-Content package.json) -replace '{{AUTHOR_EMAIL}}', '%AUTHOR_EMAIL%' | Set-Content package.json"
powershell -Command "(Get-Content package.json) -replace '{{GITHUB_USERNAME}}', '%GITHUB_USERNAME%' | Set-Content package.json"

REM Update README.md
powershell -Command "(Get-Content README.md) -replace '{{PROJECT_NAME}}', '%PROJECT_NAME%' | Set-Content README.md"
powershell -Command "(Get-Content README.md) -replace '{{PROJECT_DESCRIPTION}}', '%PROJECT_DESCRIPTION%' | Set-Content README.md"

REM Copy environment file
copy .env.example .env

echo.
echo ✅ Template customized successfully!
echo.
echo 🔧 Next steps:
echo 1. Install dependencies: npm install
echo 2. Configure your .env file with real values
echo 3. Set up your database
echo 4. Start development: npm run start:dev
echo.
echo 📚 Documentation:
echo - Quick Start: ./QUICK-START.md
echo - VS Code Setup: ./.vscode/README.md
echo - Security Guide: ./docs/ENV-SECURITY-NOTICE.md
echo.
echo 🎉 Happy coding!
pause
