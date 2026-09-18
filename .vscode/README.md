# VS Code Configuration

Esta carpeta contiene configuraciones de VS Code optimizadas para el desarrollo de la API con NestJS.

## 📁 Archivos Incluidos

### `tasks.json` - Tareas de Automatización
Define tareas para ejecutar comandos comunes:

- **🔨 Build Application**: Compila el proyecto TypeScript
- **🚀 Start Development Server**: Inicia el servidor con hot reload
- **🧹 Lint & Fix**: Ejecuta ESLint y corrige problemas automáticamente
- **🧪 Run Tests**: Ejecuta tests unitarios
- **📦 Install Dependencies**: Instala dependencias npm
- **🐳 Docker - Start Development**: Inicia servicios con Docker Compose

**Uso**: `Ctrl+Shift+P` → `Tasks: Run Task`

### `launch.json` - Configuraciones de Debug
Define configuraciones para debugging:

- **🐛 Debug API (Development)**: Debug en modo desarrollo
- **🔍 Debug API (QA)**: Debug con configuración de QA
- **🚀 Debug API (Production)**: Debug en modo producción
- **🧪 Debug Tests**: Debug de tests unitarios

**Uso**: Presiona `F5` o ve a la pestaña "Run and Debug"

### `settings.json` - Configuraciones del Editor
Configuraciones automáticas del workspace:

- ✅ Formateo automático al guardar con Prettier
- ✅ Corrección automática de ESLint
- ✅ Auto-imports de TypeScript
- ✅ Configuraciones de Jest para testing
- ✅ Exclusión de carpetas innecesarias (`node_modules`, `dist`)

### `extensions.json` - Extensiones Recomendadas
Lista de extensiones recomendadas para el proyecto:

- **TypeScript**: Soporte mejorado para TypeScript
- **Prettier**: Formateo de código
- **ESLint**: Linting y calidad de código
- **Jest**: Testing framework
- **Docker**: Soporte para contenedores
- **Prisma**: ORM database toolkit
- **GitLens**: Git supercharged

## 🚀 Cómo Ejecutar la Aplicación

### Opción 1: Usando Tareas de VS Code
1. Presiona `Ctrl+Shift+P`
2. Escribe "Tasks: Run Task"
3. Selecciona "Start Development Server"

### Opción 2: Usando Debug
1. Presiona `F5`
2. Selecciona "Debug API (Development)"
3. La aplicación se iniciará con debugging habilitado

### Opción 3: Terminal Integrado
1. Abre terminal: `Ctrl+`` `
2. Ejecuta: `npm run start:dev`

## 🔧 Configuración Inicial

### 1. Instalar Extensiones Recomendadas
VS Code te preguntará automáticamente si quieres instalar las extensiones recomendadas.

### 2. Configurar Variables de Entorno
Asegúrate de tener el archivo `.env` configurado:
```bash
cp .env.example .env
# Edita .env con tus valores
```

### 3. Instalar Dependencias
```bash
npm install
```

### 4. Configurar Base de Datos
```bash
# Generar cliente Prisma
npm run prisma:generate

# Ejecutar migraciones
npm run prisma:migrate
```

## 📝 Atajos de Teclado Útiles

| Atajo | Acción |
|-------|--------|
| `F5` | Iniciar debugging |
| `Ctrl+Shift+P` | Paleta de comandos |
| `Ctrl+Shift+`` ` | Nueva terminal |
| `Ctrl+S` | Guardar (con auto-formato) |
| `Ctrl+Shift+F` | Buscar en todos los archivos |
| `Ctrl+D` | Seleccionar siguiente ocurrencia |
| `Alt+Shift+F` | Formatear documento |

## 🐛 Debug Tips

1. **Breakpoints**: Haz clic en el margen izquierdo del editor
2. **Variables**: Inspecciona variables en la vista "Variables"
3. **Console**: Usa `console.log()` o la vista "Debug Console"
4. **Hot Reload**: Los cambios se aplican automáticamente sin reiniciar

## 🧪 Testing

Para ejecutar tests:
1. `Ctrl+Shift+P` → "Tasks: Run Task" → "Run Tests"
2. O usa la extensión Jest para ejecutar tests individuales

## 🐳 Docker (Opcional)

Para usar Docker:
1. `Ctrl+Shift+P` → "Tasks: Run Task" → "Docker - Start Development"
2. Esto iniciará Postgres

---

¡Estas configuraciones están optimizadas para máxima productividad! 🚀
