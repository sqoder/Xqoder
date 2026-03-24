import * as fs from 'node:fs';
import * as path from 'node:path';

export function buildThemeSliceOperations(theme, repoRoot) {
  const root = path.resolve(repoRoot);
  return [...theme.paths]
    .sort((left, right) => left.localeCompare(right))
    .filter((relativePath) => !shouldSkipThemeExtractionPath(relativePath))
    .map((relativePath) => {
      const sourcePath = path.join(root, relativePath);
      return {
        path: relativePath,
        sourcePath,
        action: fs.existsSync(sourcePath) ? 'copy' : 'delete',
      };
    });
}

export function applyThemeSliceOperations({ operations, targetRoot }) {
  const root = path.resolve(targetRoot);
  for (const operation of operations) {
    const targetPath = path.join(root, operation.path);
    if (operation.action === 'delete') {
      fs.rmSync(targetPath, { recursive: true, force: true });
      continue;
    }
    copyEntry(operation.sourcePath, targetPath, operation.path);
  }
}

function copyEntry(sourcePath, targetPath, rootRelativePath) {
  const stat = fs.lstatSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (stat.isSymbolicLink()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    return;
  }

  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, targetPath, {
      dereference: false,
      force: true,
      recursive: true,
      filter: (currentSourcePath) => {
        const nestedRelativePath = path.join(
          rootRelativePath,
          path.relative(sourcePath, currentSourcePath),
        );
        return !shouldSkipThemeExtractionPath(nestedRelativePath);
      },
    });
    return;
  }

  fs.cpSync(sourcePath, targetPath, {
    dereference: false,
    force: true,
    preserveTimestamps: true,
  });
}

function shouldSkipThemeExtractionPath(filePath) {
  const normalizedPath = filePath.split(path.sep).join('/');
  return normalizedPath === 'packages/renderer/target'
    || normalizedPath.startsWith('packages/renderer/target/')
    || /^packages\/renderer\/index\..+\.node$/u.test(normalizedPath);
}
