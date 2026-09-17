#!/usr/bin/env node
/**
 * PreToolUse — impede que Claude leia ou escreva arquivos de segredo.
 *
 * Recebe o payload do hook por stdin e devolve uma decisão de permissão.
 * Bloquear a LEITURA importa tanto quanto bloquear a escrita: uma chave lida
 * entra no contexto e pode acabar reproduzida em log, resposta ou commit.
 */

const BLOCKED = [
  { re: /(^|[\\/])\.env$/i, why: '.env guarda as credenciais dos providers de voo' },
  { re: /(^|[\\/])\.env\.(local|production|staging)$/i, why: 'arquivo .env de ambiente' },
  { re: /\.(key|pem|p12|pfx)$/i, why: 'chave privada' },
  { re: /(^|[\\/])storage[\\/]oauth-.*\.key$/i, why: 'chave do Passport/OAuth' },
  { re: /(^|[\\/])auth\.json$/i, why: 'credenciais do Composer' },
];

// .env.example é o template versionado, sem segredo — precisa continuar legível.
const ALLOWED = [/(^|[\\/])\.env\.example$/i, /(^|[\\/])\.env\.testing$/i];

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
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    allow(); // payload ilegível não é motivo para travar o trabalho
  }

  const path = payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? '';
  if (!path) allow();

  if (ALLOWED.some((re) => re.test(path))) allow();

  const hit = BLOCKED.find((b) => b.re.test(path));
  if (!hit) allow();

  deny(
    `Bloqueado pelo hook de segurança do projeto: ${path} é ${hit.why}. ` +
      `Leia .env.example para saber quais variáveis existem, e peça ao usuário ` +
      `para preencher os valores reais — eles não devem passar pelo contexto do agente.`,
  );
});
