import fs from 'fs';
import path from 'path';

/**
 * Automatically scans the current working directory to detect installed frameworks.
 * @returns {Array<Object>} Array of inferred microservices
 */
export function detectLocalStack() {
  const cwd = process.cwd();
  const services = [];
  services.push(...detectNodeServices(cwd));
  services.push(...detectPythonServices(cwd));
  if (services.length === 0) {
    services.push({
      name: 'unknown-service',
      type: 'unknown',
      command: 'echo "No supported framework detected"',
      color: 'blue',
    });
  }
  return services;
}

/** * Detect Node.js services */
function detectNodeServices(cwd) {
  const services = [];
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return services;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };
    const has = (pkg) => pkg in deps;

    const command = packageJson.scripts?.dev
      ? 'npm run dev'
      : packageJson.scripts?.start
        ? 'npm start'
        : null;

    if (!command) {
      return services;
    }

    const frontendFrameworks = {
      next: 'Next.js',
      react: 'React',
      vue: 'Vue.js',
      svelte: 'Svelte',
      vite: 'Vite',
      angular: 'Angular',
    };

    const backendFrameworks = {
      express: 'Express',
      koa: 'Koa',
      hapi: 'Hapi',
      fastify: 'Fastify',
      '@nestjs/core': 'NestJS',
    };

    const frontendFramework = Object.keys(frontendFrameworks).find(has);

    const backendFramework = Object.keys(backendFrameworks).find(has);

    if (frontendFramework) {
      services.push({
        name: 'frontend',
        type: 'frontend',
        framework: frontendFrameworks[frontendFramework],
        command,
        color: 'cyan',
      });
    }
    if (backendFramework) {
      services.push({
        name: 'backend',
        type: 'backend',
        framework: backendFrameworks[backendFramework],
        command,
        color: 'magenta',
      });
    }
  } catch (error) {
    console.error('Failed to parse package.json:', error.message);
  }
  return services;
}
/** * Detect Python services */
function detectPythonServices(cwd) {
  const services = [];
  const requirementsPath = path.join(cwd, 'requirements.txt');
  const pyprojectPath = path.join(cwd, 'pyproject.toml');

  let content = '';

  if (fs.existsSync(requirementsPath)) {
    content += fs.readFileSync(requirementsPath, 'utf-8');
  }

  if (fs.existsSync(pyprojectPath)) {
    content += fs.readFileSync(pyprojectPath, 'utf-8');
  }

  if (!content) {
    return services;
  }

  const lower = content.toLowerCase();

  if (lower.includes('fastapi')) {
    services.push({
      name: 'python-api',
      type: 'backend',
      framework: 'FastAPI',
      command: 'uvicorn main:app --reload',
      color: 'yellow',
    });
  }
  if (lower.includes('flask')) {
    services.push({
      name: 'python-api',
      type: 'backend',
      framework: 'Flask',
      command: 'python app.py',
      color: 'yellow',
    });
  }
  if (lower.includes('django')) {
    services.push({
      name: 'python-api',
      type: 'backend',
      framework: 'Django',
      command: 'python manage.py runserver',
      color: 'yellow',
    });
  }
  return services;
}

/**
 * Loads the active config file or throws if missing.
 * @returns {Object} Parsed configuration object
 */

export function loadConfig() {
  const configPath = path.join(process.cwd(), 'tracewatch.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'tracewatch.json profile missing. Please run "tracewatch init" first.',
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
