#!/usr/bin/env node
/**
 * PreToolUse (Bash) — barra operações de git que são difíceis ou impossíveis de desfazer.
 *
 * Commit direto na main, push forçado e bypass de hooks não são estilo: são as
 * três formas mais comuns de perder trabalho ou publicar algo sem revisão.
 */

import { execSync } from 'node:child_process';

const RULES = [
  {
    re: /\bgit\s+push\b[^|;&]*\s(--force|-f)\b/,
    reason:
      'git push --force reescreve o histórico remoto e pode apagar trabalho de outra pessoa. ' +
      'Se precisa mesmo, use --force-with-lease e peça confirmação explícita ao usuário.',
  },
  {
    re: /\bgit\s+(commit|merge|rebase)\b[^|;&]*--no-verify\b/,
    reason:
      '--no-verify pula os hooks de qualidade do repositório. Se um hook está falhando, ' +
      'o certo é corrigir a causa — o hook existe porque alguém já errou ali antes.',
  },
  {
    re: /\bgit\s+reset\s+--hard\b/,
    reason:
      'git reset --hard descarta alterações não commitadas de forma irreversível. ' +
      'Considere git stash, que preserva o trabalho.',
  },
  {
    re: /\bgit\s+checkout\s+(main|master)\b[^|;&]*\s--\s/,
    reason: 'git checkout -- descarta alterações locais sem possibilidade de recuperação.',
  },
];

const allow = () => process.exit(0);

const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
};

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    allow();
  }
  if (!command) allow();

  const hit = RULES.find((r) => r.re.test(command));
  if (hit) deny(`Bloqueado pelo hook do projeto. ${hit.reason}`);

  // Commit na branch padrão: verificado no momento, não por texto do comando.
  if (/\bgit\s+commit\b/.test(command)) {
    let branch = '';
    try {
      branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch {
      allow(); // fora de um repositório git
    }
    if (branch === 'main' || branch === 'master') {
      // O commit inicial não tem como sair de outra branch: antes dele não
      // existe HEAD para ramificar. Bloquear aqui impediria criar o repositório.
      let hasCommits = true;
      try {
        execSync('git rev-parse --verify HEAD', { encoding: 'utf8', stdio: 'pipe' });
      } catch {
        hasCommits = false;
      }

      if (hasCommits) {
        deny(
          `Você está na branch "${branch}" e o projeto não aceita commit direto nela. ` +
            'Crie uma branch antes: git checkout -b feat/descricao-em-kebab-case',
        );
      }
    }
  }

  allow();
});
