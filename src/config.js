import fs from 'fs';
import path from 'path';

/**
 * Automatically scans the current working directory to detect installed frameworks.
 * @returns {Array<Object>} Array of inferred microservices
 */
export function detectLocalStack() {
  const cwd = process.cwd();
  const services = [];
  const scannedDirs = new Set();
  const projectDirs = [{ directory: cwd, relativePath: '.' }];
  scannedDirs.add(cwd);

  const ignoredDirs = new Set([
    'node_modules',
    '.git',
    '.github',
    'dist',
    'build',
    '.next',
    'out',
    'coverage',
    'fixtures',
    'docs',
    'bin',
    'test',
  ]);

  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        ignoredDirs.has(entry.name)
      ) {
        continue;
      }

      const fullPath = path.join(cwd, entry.name);
      scannedDirs.add(fullPath);
      projectDirs.push({ directory: fullPath, relativePath: entry.name });

      // Monorepo container support: inspect children of apps/, services/, packages/, modules/
      if (['apps', 'services', 'packages', 'modules'].includes(entry.name)) {
        try {
          const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (
              sub.isDirectory() &&
              !sub.name.startsWith('.') &&
              !ignoredDirs.has(sub.name)
            ) {
              const subFullPath = path.join(fullPath, sub.name);
              if (!scannedDirs.has(subFullPath)) {
                scannedDirs.add(subFullPath);
                projectDirs.push({
                  directory: subFullPath,
                  relativePath: path.join(entry.name, sub.name),
                });
              }
            }
          }
        } catch {
          // Skip unreadable subdirectories
        }
      }
    }
  } catch (err) {
    // Skip unreadable directories
  }

  for (const project of projectDirs) {
    services.push(
      ...detectNodeServices(project.directory, project.relativePath),
      ...detectPythonServices(project.directory, project.relativePath),
    );
  }

  if (services.length === 0) {
    services.push({
      name: 'unknown-service',
      type: 'unknown',
      command: 'echo "No supported framework detected"',
      color: 'blue',
    });
  } else {
    // Assign distinct, contrasting colors from palette
    const PALETTE = ['cyan', 'magenta', 'yellow', 'blue', 'green'];
    services.forEach((service, index) => {
      service.color = PALETTE[index % PALETTE.length];
    });
  }

  return services;
}

/** * Detect Node.js services */
function detectNodeServices(cwd, relativePath = '.') {
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

    const workingDirectory = relativePath === '.' ? undefined : relativePath;

    if (frontendFramework) {
      services.push({
        name: relativePath === '.' ? 'frontend' : path.basename(relativePath),
        type: 'frontend',
        framework: frontendFrameworks[frontendFramework],
        command,
        color: 'cyan',
        ...(workingDirectory ? { cwd: workingDirectory } : {}),
      });
    }
    if (backendFramework && !frontendFramework) {
      services.push({
        name: relativePath === '.' ? 'backend' : path.basename(relativePath),
        type: 'backend',
        framework: backendFrameworks[backendFramework],
        command,
        color: 'magenta',
        ...(workingDirectory ? { cwd: workingDirectory } : {}),
      });
    }
  } catch (error) {
    console.error('Failed to parse package.json:', error.message);
  }
  return services;
}
/** * Detect Python services */
function detectPythonServices(cwd, relativePath = '.') {
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
  const workingDirectory = relativePath === '.' ? undefined : relativePath;
  const name =
    relativePath === '.' ? 'python-api' : path.basename(relativePath);

  if (lower.includes('fastapi')) {
    services.push({
      name,
      type: 'backend',
      framework: 'FastAPI',
      command: 'uvicorn main:app --reload',
      color: 'yellow',
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
    });
  }
  if (lower.includes('flask')) {
    services.push({
      name,
      type: 'backend',
      framework: 'Flask',
      command: 'python app.py',
      color: 'yellow',
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
    });
  }
  if (lower.includes('django')) {
    services.push({
      name,
      type: 'backend',
      framework: 'Django',
      command: 'python manage.py runserver',
      color: 'yellow',
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
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
