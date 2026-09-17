#!/usr/bin/env node
/**
 * PostToolUse — formata e analisa o arquivo PHP recém-editado.
 *
 * Pint corrige o estilo; PHPStan (via Larastan) aponta erro de tipo. O objetivo
 * é que problema de estilo nunca chegue à revisão humana e erro de tipo apareça
 * no momento da edição, não no CI vinte minutos depois.
 *
 * Sai silenciosamente quando o PHP ainda não está instalado, para não atrapalhar
 * o trabalho antes do ambiente estar pronto.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const run = (cmd, args, cwd) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/** Sobe a partir do arquivo até achar a raiz do projeto Laravel. */
const findRoot = (start) => {
  let dir = dirname(resolve(start));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'artisan'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
};

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let file = '';
  try {
    const p = JSON.parse(raw);
    file = p?.tool_response?.filePath ?? p?.tool_input?.file_path ?? '';
  } catch {
    process.exit(0);
  }

  if (!file.endsWith('.php')) process.exit(0);

  const root = findRoot(file);
  if (!root) process.exit(0);

  // Sem vendor/ o ambiente ainda não foi montado — nada a fazer.
  if (!existsSync(resolve(root, 'vendor', 'bin', 'pint'))) process.exit(0);

  const php = existsSync(resolve(root, 'herd.bat')) ? 'herd' : 'php';
  const phpArgs = php === 'herd' ? ['php'] : [];

  run(php, [...phpArgs, 'vendor/bin/pint', file], root);

  const stan = run(
    php,
    [...phpArgs, 'vendor/bin/phpstan', 'analyse', file, '--no-progress', '--memory-limit=512M'],
    root,
  );

  if (!stan.ok) {
    // exit 2 devolve a saída ao agente para que ele corrija agora, não depois.
    process.stderr.write(
      `PHPStan encontrou problemas em ${file}:\n\n${stan.out}\n\n` +
        'Corrija antes de seguir — o CI roda a mesma análise.\n',
    );
    process.exit(2);
  }

  process.exit(0);
});
