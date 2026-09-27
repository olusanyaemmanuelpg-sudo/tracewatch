import fs from 'fs';
import path from 'path';

/**
 * Detects the package manager used in a directory or its parents.
 * Checks for packageManager field in package.json, lockfiles (pnpm, yarn, bun, npm),
 * and workspace configurations.
 * @param {string} dir - Directory to inspect
 * @returns {'pnpm' | 'yarn' | 'bun' | 'npm'}
 */
export function detectPackageManager(dir = process.cwd()) {
  let currentDir = path.resolve(dir);
  const rootDir = path.parse(currentDir).root;

  while (true) {
    const pkgPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.packageManager && typeof pkg.packageManager === 'string') {
          const pm = pkg.packageManager.toLowerCase();
          if (pm.startsWith('pnpm')) return 'pnpm';
          if (pm.startsWith('yarn')) return 'yarn';
          if (pm.startsWith('bun')) return 'bun';
          if (pm.startsWith('npm')) return 'npm';
        }
      } catch {
        // Skip unparseable package.json
      }
    }

    if (
      fs.existsSync(path.join(currentDir, 'pnpm-lock.yaml')) ||
      fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(currentDir, 'node_modules', '.pnpm'))
    ) {
      return 'pnpm';
    }

    if (
      fs.existsSync(path.join(currentDir, 'yarn.lock')) ||
      fs.existsSync(path.join(currentDir, '.yarnrc')) ||
      fs.existsSync(path.join(currentDir, '.yarnrc.yml'))
    ) {
      return 'yarn';
    }

    if (
      fs.existsSync(path.join(currentDir, 'bun.lockb')) ||
      fs.existsSync(path.join(currentDir, 'bun.lock'))
    ) {
      return 'bun';
    }

    if (fs.existsSync(path.join(currentDir, 'package-lock.json'))) {
      return 'npm';
    }

    if (currentDir === process.cwd() || currentDir === rootDir) {
      break;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  // Final check at process.cwd() in case inspect dir is elsewhere
  const procCwd = process.cwd();
  if (
    fs.existsSync(path.join(procCwd, 'pnpm-lock.yaml')) ||
    fs.existsSync(path.join(procCwd, 'pnpm-workspace.yaml')) ||
    fs.existsSync(path.join(procCwd, 'node_modules', '.pnpm'))
  ) {
    return 'pnpm';
  }
  if (
    fs.existsSync(path.join(procCwd, 'yarn.lock')) ||
    fs.existsSync(path.join(procCwd, '.yarnrc')) ||
    fs.existsSync(path.join(procCwd, '.yarnrc.yml'))
  ) {
    return 'yarn';
  }
  if (
    fs.existsSync(path.join(procCwd, 'bun.lockb')) ||
    fs.existsSync(path.join(procCwd, 'bun.lock'))
  ) {
    return 'bun';
  }
  if (fs.existsSync(path.join(procCwd, 'package-lock.json'))) {
    return 'npm';
  }

  return 'npm';
}

/**
 * Resolves the most appropriate script to start/dev a Node service from package.json scripts.
 * Prioritizes development and start variants (e.g. dev, start/dev, start:dev, start/pure, start, etc.)
 * @param {Record<string, string>} scripts
 * @returns {string|null}
 */
export function resolveNodeScript(scripts = {}) {
  if (!scripts || typeof scripts !== 'object') return null;
  const keys = Object.keys(scripts);
  if (keys.length === 0) return null;

  // 1. Exact dev script
  if (keys.includes('dev')) return 'dev';

  // 2. High-priority dev variants
  const devVariants = [
    'start/dev',
    'start:dev',
    'dev/start',
    'dev:start',
    'dev:server',
    'dev/server',
    'dev:api',
    'dev/api',
    'dev:app',
    'dev/app',
    'dev:backend',
    'dev/backend',
    'dev:all',
    'dev:watch',
    'develop',
    'serve',
    'server',
    'watch',
  ];
  for (const v of devVariants) {
    if (keys.includes(v)) return v;
  }

  // Any script starting with dev: or dev/ or matching /^(dev|develop|serve)([:/_-]|$)/i
  const devPrefixMatch = keys.find((k) =>
    /^(dev|develop|serve)([:/_-]|$)/i.test(k),
  );
  if (devPrefixMatch) return devPrefixMatch;

  // Any start:dev / start/dev variant
  const startDevMatch = keys.find((k) => /^start[:/_-]dev/i.test(k));
  if (startDevMatch) return startDevMatch;

  // 3. Exact start script
  if (keys.includes('start')) return 'start';

  // 4. Start variants (including start/pure, start:pure, start/local, etc.)
  const startVariants = [
    'start/pure',
    'start:pure',
    'start/local',
    'start:local',
    'start/app',
    'start:app',
    'start/server',
    'start:server',
    'start/api',
    'start:api',
    'start/standalone',
    'start:standalone',
  ];
  for (const v of startVariants) {
    if (keys.includes(v)) return v;
  }

  // Any script starting with start: or start/ (excluding prod if another exists)
  const startPrefixMatch = keys.find((k) =>
    /^start([:/_-]|$)/i.test(k) && !/prod/i.test(k),
  );
  if (startPrefixMatch) return startPrefixMatch;

  // 5. Any generic script containing dev or start or serve or run
  const genericMatch = keys.find((k) =>
    /(?:^|[-_:/])(dev|start|serve|run)(?:[-_:/]|$)/i.test(k),
  );
  if (genericMatch) return genericMatch;

  // 6. First non-tooling script
  const nonTooling = keys.find(
    (k) =>
      !/^(test|lint|format|prettier|typecheck|tsc|build|clean|release|publish|prepare|postinstall|preinstall|commit)/i.test(
        k,
      ),
  );
  if (nonTooling) return nonTooling;

  // 7. Fallback to start:prod or start/prod if available
  if (keys.includes('start:prod')) return 'start:prod';
  if (keys.includes('start/prod')) return 'start/prod';

  return null;
}

/**
 * Formats command according to detected package manager and script name.
 * @param {'pnpm' | 'yarn' | 'bun' | 'npm'} pm
 * @param {string} script
 * @returns {string}
 */
export function formatPackageManagerCommand(pm, script) {
  switch (pm) {
    case 'pnpm':
      return script === 'start' ? 'pnpm start' : `pnpm run ${script}`;
    case 'yarn':
      return script === 'start' ? 'yarn start' : `yarn run ${script}`;
    case 'bun':
      return script === 'start' ? 'bun start' : `bun run ${script}`;
    case 'npm':
    default:
      return script === 'start' ? 'npm start' : `npm run ${script}`;
  }
}

/**
 * Resolves runnable command for a Node.js project.
 * Uses scripts from package.json formatted with detected package manager,
 * or falls back to common entrypoint files (server.js, app.js, index.js).
 * @param {Object} packageJson
 * @param {'pnpm' | 'yarn' | 'bun' | 'npm'} packageManager
 * @param {string} cwd
 * @returns {string|null}
 */
export function resolveNodeCommand(
  packageJson,
  packageManager = 'npm',
  cwd = process.cwd(),
) {
  const script = resolveNodeScript(packageJson?.scripts);
  if (script) {
    return formatPackageManagerCommand(packageManager, script);
  }

  // Fallback: check entry files if no scripts matched or scripts is missing
  if (packageJson?.main) {
    const mainFile = packageJson.main;
    if (fs.existsSync(path.join(cwd, mainFile))) {
      return `node ${mainFile}`;
    }
  }

  const commonEntries = [
    'server.js',
    'app.js',
    'index.js',
    'main.js',
    'src/server.js',
    'src/app.js',
    'src/index.js',
    'src/main.js',
  ];
  for (const entry of commonEntries) {
    if (fs.existsSync(path.join(cwd, entry))) {
      return `node ${entry}`;
    }
  }

  return null;
}

/**
 * Automatically scans the current working directory to detect installed frameworks.
 * Supports multi-folder monorepos, pnpm workspaces, and alternative scripts.
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @returns {Array<Object>} Array of inferred microservices
 */
export function detectLocalStack(options = {}) {
  const cwd = options.cwd || process.cwd();
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
    '.turbo',
    '.vscode',
    '.idea',
    'vendor',
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

      const isContainer = [
        'apps',
        'services',
        'packages',
        'modules',
        'projects',
        'libs',
        'components',
      ].includes(entry.name.toLowerCase());

      const hasDirectProjectFiles =
        fs.existsSync(path.join(fullPath, 'package.json')) ||
        fs.existsSync(path.join(fullPath, 'requirements.txt')) ||
        fs.existsSync(path.join(fullPath, 'pyproject.toml'));

      // If directory is a container or does not have direct project files, check subdirectories
      if (isContainer || !hasDirectProjectFiles) {
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

  // Parse pnpm-workspace.yaml if present to discover configured workspace directories
  const pnpmWorkspacePath = path.join(cwd, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const content = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/-\s*['"]?([^'"#\s]+)['"]?/);
        if (match) {
          const pattern = match[1].replace(/\/\*$/, '');
          const containerPath = path.join(cwd, pattern);
          if (
            fs.existsSync(containerPath) &&
            fs.statSync(containerPath).isDirectory()
          ) {
            if (!scannedDirs.has(containerPath)) {
              scannedDirs.add(containerPath);
              projectDirs.push({
                directory: containerPath,
                relativePath: pattern,
              });
            }
            try {
              const subs = fs.readdirSync(containerPath, {
                withFileTypes: true,
              });
              for (const sub of subs) {
                if (
                  sub.isDirectory() &&
                  !sub.name.startsWith('.') &&
                  !ignoredDirs.has(sub.name)
                ) {
                  const subFullPath = path.join(containerPath, sub.name);
                  if (!scannedDirs.has(subFullPath)) {
                    scannedDirs.add(subFullPath);
                    projectDirs.push({
                      directory: subFullPath,
                      relativePath: path.join(pattern, sub.name),
                    });
                  }
                }
              }
            } catch {
              // Ignore unreadable
            }
          }
        }
      }
    } catch {
      // Ignore unparseable workspace
    }
  }

  const detectedChildServices = [];
  const detectedRootServices = [];

  for (const project of projectDirs) {
    const found = [
      ...detectNodeServices(project.directory, project.relativePath),
      ...detectPythonServices(project.directory, project.relativePath),
    ];
    if (project.relativePath === '.') {
      detectedRootServices.push(...found);
    } else {
      detectedChildServices.push(...found);
    }
  }

  // If sub-services are found in child directories, check if root is just a monorepo workspace orchestrator
  if (detectedChildServices.length > 0) {
    const isMonorepoRoot =
      fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(cwd, 'turbo.json')) ||
      fs.existsSync(path.join(cwd, 'lerna.json')) ||
      (() => {
        try {
          const pkg = JSON.parse(
            fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'),
          );
          return Boolean(pkg.workspaces || pkg.private);
        } catch {
          return false;
        }
      })();

    if (!isMonorepoRoot) {
      services.push(...detectedRootServices);
    }
    services.push(...detectedChildServices);
  } else {
    services.push(...detectedRootServices);
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

/**
 * Detect Node.js services
 * @param {string} cwd
 * @param {string} relativePath
 * @returns {Array<Object>}
 */
export function detectNodeServices(cwd, relativePath = '.') {
  const services = [];
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    // Check for raw server entry files when package.json is missing
    const rawServer = ['server.js', 'app.js'].find((f) =>
      fs.existsSync(path.join(cwd, f)),
    );
    if (rawServer) {
      const workingDirectory = relativePath === '.' ? undefined : relativePath;
      services.push({
        name: relativePath === '.' ? 'backend' : path.basename(relativePath),
        type: 'backend',
        framework: 'Node.js',
        command: `node ${rawServer}`,
        color: 'magenta',
        ...(workingDirectory ? { cwd: workingDirectory } : {}),
      });
    }
    return services;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };
    const has = (pkg) => pkg in deps;

    const pm = detectPackageManager(cwd);
    const command = resolveNodeCommand(packageJson, pm, cwd);

    if (!command) {
      return services;
    }

    const frontendFrameworks = {
      next: 'Next.js',
      react: 'React',
      vue: 'Vue.js',
      svelte: 'Svelte',
      '@sveltejs/kit': 'SvelteKit',
      vite: 'Vite',
      astro: 'Astro',
      angular: 'Angular',
      '@angular/core': 'Angular',
      nuxt: 'Nuxt',
      remix: 'Remix',
      '@remix-run/dev': 'Remix',
      'solid-js': 'Solid',
      gatsby: 'Gatsby',
    };

    const backendFrameworks = {
      express: 'Express',
      koa: 'Koa',
      hapi: 'Hapi',
      '@hapi/hapi': 'Hapi',
      fastify: 'Fastify',
      '@nestjs/core': 'NestJS',
      hono: 'Hono',
      elysia: 'Elysia',
      '@adonisjs/core': 'AdonisJS',
      featherjs: 'Feathers',
      polka: 'Polka',
      'socket.io': 'Socket.IO',
      ws: 'WebSocket',
      trpc: 'tRPC',
      '@trpc/server': 'tRPC',
    };

    const frontendFrameworkKey = Object.keys(frontendFrameworks).find(has);
    const backendFrameworkKey = Object.keys(backendFrameworks).find(has);

    let type = 'backend';
    let frameworkName = 'Node.js';

    if (frontendFrameworkKey) {
      type = 'frontend';
      frameworkName = frontendFrameworks[frontendFrameworkKey];
    } else if (backendFrameworkKey) {
      type = 'backend';
      frameworkName = backendFrameworks[backendFrameworkKey];
    } else {
      // Heuristic classification when dependencies lack a known framework brand
      const dirName = (
        relativePath === '.'
          ? path.basename(cwd)
          : path.basename(relativePath)
      ).toLowerCase();
      const hasFrontendFile =
        fs.existsSync(path.join(cwd, 'index.html')) ||
        fs.existsSync(path.join(cwd, 'vite.config.js')) ||
        fs.existsSync(path.join(cwd, 'vite.config.ts'));
      const hasBackendFile =
        fs.existsSync(path.join(cwd, 'server.js')) ||
        fs.existsSync(path.join(cwd, 'app.js')) ||
        fs.existsSync(path.join(cwd, 'src', 'server.js')) ||
        fs.existsSync(path.join(cwd, 'src', 'app.js'));

      const isFrontendName =
        /^(frontend|front|client|web|ui|app|view)$/i.test(dirName) ||
        /(?:^|[-_])(frontend|client|web|ui)(?:[-_]|$)/i.test(dirName);
      const isBackendName =
        /^(backend|back|api|server|srv|service|worker|core)$/i.test(dirName) ||
        /(?:^|[-_])(backend|api|server|service)(?:[-_]|$)/i.test(dirName);

      if (hasFrontendFile || (isFrontendName && !hasBackendFile)) {
        type = 'frontend';
        frameworkName = 'Node.js';
      } else if (hasBackendFile || isBackendName) {
        type = 'backend';
        frameworkName = 'Node.js';
      } else {
        type = 'backend';
        frameworkName = 'Node.js';
      }
    }

    const workingDirectory = relativePath === '.' ? undefined : relativePath;
    const serviceName =
      relativePath === '.'
        ? type === 'frontend'
          ? 'frontend'
          : 'backend'
        : path.basename(relativePath);

    services.push({
      name: serviceName,
      type,
      framework: frameworkName,
      command,
      color: type === 'frontend' ? 'cyan' : 'magenta',
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
    });
  } catch (error) {
    console.error('Failed to parse package.json:', error.message);
  }
  return services;
}

/**
 * Detect Python services
 * @param {string} cwd
 * @param {string} relativePath
 * @returns {Array<Object>}
 */
export function detectPythonServices(cwd, relativePath = '.') {
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
