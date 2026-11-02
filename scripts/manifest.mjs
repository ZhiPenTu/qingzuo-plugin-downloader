import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadPackagedManifest(root = process.cwd()) {
  const directory = path.resolve(root);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const icon = await readFile(path.join(directory, 'assets/icon.png'));
  return {
    ...pkg,
    commerce: {
      ...pkg.commerce,
      icon: 'data:image/png;base64,' + icon.toString('base64'),
    },
  };
}
