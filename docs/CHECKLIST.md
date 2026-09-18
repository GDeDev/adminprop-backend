# ✅ Checklist: Configuración Template NestJS API

Usa esta checklist para asegurar que tu proyecto desde el template esté correctamente configurado.

## 🚀 Configuración Inicial

### Paso 1: Crear Proyecto desde Template

- [ ] Usar ["Use this template"](https://github.com/Grupo-Centaurus/vulcan-nest-api-template/generate) en GitHub
- [ ] Clonar tu nuevo repositorio
- [ ] Navegar al directorio del proyecto

### Paso 2: Ejecutar Script de Configuración

- [ ] Ejecutar `./scripts/init-template.sh` (Linux/Mac) o `scripts\init-template.bat` (Windows)
- [ ] Proporcionar nombre del proyecto
- [ ] Proporcionar descripción
- [ ] Proporcionar información del autor
- [ ] Proporcionar username de GitHub
- [ ] Configurar nombre de base de datos

### Paso 3: Instalación de Dependencias

- [ ] Ejecutar `npm install`
- [ ] Verificar que no hay errores de instalación
- [ ] Verificar versión de Node.js (>=18.0.0)

## ⚙️ Configuración de Entorno

### Variables de Entorno

- [ ] Verificar que existe archivo `.env` (copiado desde `.env.example`)
- [ ] Configurar `DATABASE_URL` con tu conexión a MariaDB
- [ ] Verificar `JWT_SECRET` (debe ser diferente del ejemplo)
- [ ] Configurar `NODE_ENV=development`
- [ ] Configurar `PORT=3000` (o tu puerto preferido)
- [ ] Si usas AWS: configurar `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

### Base de Datos

- [ ] Iniciar MariaDB (con Docker: `npm run docker:dev`)
- [ ] Verificar conexión a la base de datos
- [ ] Ejecutar `npm run prisma:generate`
- [ ] Ejecutar `npm run prisma:migrate`
- [ ] (Opcional) Ejecutar `npm run prisma:seed` para datos de ejemplo

## 🧪 Verificación de Funcionamiento

### Desarrollo Local

- [ ] Ejecutar `npm run start:dev`
- [ ] Verificar que la aplicación inicia sin errores
- [ ] Abrir http://localhost:3000 (o tu puerto configurado)
- [ ] Verificar endpoint de health: http://localhost:3000/health
- [ ] Abrir Swagger UI: http://localhost:3000/api/docs

### Tests

- [ ] Ejecutar `npm test` (tests unitarios)
- [ ] Ejecutar `npm run test:e2e` (tests end-to-end)
- [ ] Verificar que todos los tests pasan
- [ ] Ejecutar `npm run test:cov` para ver coverage

### Calidad de Código

- [ ] Ejecutar `npm run code:check` (ESLint + Prettier)
- [ ] Verificar que no hay errores de linting
- [ ] Verificar que el código está correctamente formateado

## 🔧 Configuración de Desarrollo

### VS Code (Recomendado)

- [ ] Instalar extensiones recomendadas (VS Code te las sugerirá)
- [ ] Verificar que IntelliSense funciona correctamente
- [ ] Probar debugging (F5) - ver [VSCODE-SETUP.md](VSCODE-SETUP.md)
- [ ] Verificar que funcionan los snippets y auto-imports

### Git Hooks

- [ ] Verificar que Husky está configurado: `.husky/pre-commit`
- [ ] Hacer un commit de prueba para verificar pre-commit hooks
- [ ] Verificar que se ejecuta ESLint y tests antes del commit

## 📝 Personalización del Proyecto

### Documentación

- [ ] Actualizar `README.md` con información específica de tu proyecto
- [ ] Personalizar descripción del proyecto en `package.json`
- [ ] Actualizar información del autor en `package.json`
- [ ] Revisar y personalizar archivos en `docs/`

### Configuración Específica

- [ ] Configurar CORS si es necesario: `src/main.ts`
- [ ] Configurar rate limiting si es necesario
- [ ] Personalizar logging levels en `src/shared/config/`
- [ ] Configurar variables de entorno específicas de tu aplicación

## 🐳 Docker y Producción

### Docker Development

- [ ] Verificar que `docker-compose.yml` funciona: `npm run docker:dev`
- [ ] Verificar que la aplicación se conecta a la DB en Docker
- [ ] Probar que los volúmenes persisten datos

### Docker Production

- [ ] Build imagen de producción: `docker build -t mi-api .`
- [ ] Probar imagen en ambiente local
- [ ] Verificar que las variables de entorno funcionan en producción

## 🚀 CI/CD y Deploy

### GitHub Actions

- [ ] Verificar que los workflows en `.github/workflows/` son correctos
- [ ] Configurar secrets necesarios en GitHub si planeas usar CI/CD
- [ ] Probar que el pipeline ejecuta en PR de prueba

### Secrets de GitHub (si usas CI/CD)

- [ ] `AWS_ACCESS_KEY_ID` (si usas AWS)
- [ ] `AWS_SECRET_ACCESS_KEY` (si usas AWS)
- [ ] `AWS_REGION` (si usas AWS)
- [ ] `ECR_REPOSITORY` (si usas ECR)
- [ ] Otros secrets específicos de tu setup

## ✨ Funcionalidades Adicionales

### Monitoreo y Observabilidad

- [ ] Configurar health checks adicionales si necesario
- [ ] Configurar métricas customizadas si necesario
- [ ] Configurar logging adicional según tus necesidades

### Seguridad

- [ ] Cambiar todos los secrets por defecto
- [ ] Configurar autenticación si es necesario
- [ ] Revisar configuración de CORS
- [ ] Configurar rate limiting si es para producción

### Base de Datos

- [ ] Personalizar schema de Prisma según tu dominio: `prisma/schema.prisma`
- [ ] Crear migraciones para tu modelo de datos
- [ ] Configurar seeding con datos relevantes para tu aplicación
- [ ] Configurar backup strategy si es para producción

## 📚 Próximos Pasos

### Desarrollo

- [ ] Leer [MANUAL-COMPLETO.md](MANUAL-COMPLETO.md) para guías detalladas
- [ ] Revisar ejemplos de código en `src/application/handlers/`
- [ ] Entender la estructura hexagonal del proyecto
- [ ] Familiarizarse con el patrón CQRS implementado

### Contribuir al Template

- [ ] Leer [CONTRIBUTING.md](CONTRIBUTING.md) si planeas contribuir
- [ ] Reportar bugs o sugerir mejoras via GitHub Issues
- [ ] Compartir tu experiencia con la comunidad

---

## 🆘 Si Algo No Funciona

1. **Revisa los logs** en la terminal donde ejecutas `npm run start:dev`
2. **Verifica variables de entorno** en `.env`
3. **Revisa la documentación** en `DEBUGGING.md`
4. **Busca en GitHub Issues** problemas similares
5. **Crea un issue** usando el [template de soporte](../../issues/new?template=template_support.md)

---

**¡Una vez completada esta checklist, tu API NestJS estará lista para desarrollo! 🚀**
