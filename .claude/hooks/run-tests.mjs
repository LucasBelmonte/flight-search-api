#!/usr/bin/env node
/**
 * Stop — roda a suíte quando o agente termina o turno.
 *
 * Roda em background (async) para não segurar o terminal. O resultado aparece
 * como mensagem do sistema: teste quebrado vira notícia na hora, não no CI.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const quiet = () => process.exit(0);

// Ambiente ainda não montado: nada a rodar.
if (!existsSync(resolve(root, 'vendor', 'bin', 'pest'))) quiet();

const php = existsSync(resolve(root, 'herd.bat')) ? 'herd' : 'php';
const args = php === 'herd' ? ['php', 'artisan', 'test', '--parallel'] : ['artisan', 'test', '--parallel'];

try {
  execFileSync(php, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  quiet();
} catch (e) {
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  const failed = out.match(/Tests:\s+.*/)?.[0] ?? 'a suíte falhou';
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Testes da API falhando — ${failed}. Rode: herd php artisan test`,
    }),
  );
  process.exit(0);
}
