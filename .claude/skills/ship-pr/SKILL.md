---
name: ship-pr
description: Fluxo completo para publicar trabalho do Flight Search - rodar a suíte, revisar, auditar segurança, commitar e abrir PR nos repositórios separados de API e SPA. Use quando a implementação está pronta e você vai publicar no GitHub.
---

# Publicando trabalho no Flight Search

Dois repositórios independentes. Confirme em qual você está antes de começar.

## A sequência

```
1. suíte passando       (não negociável)
2. code-reviewer        revisa o diff
3. security-auditor     se tocou auth, provider externo ou endpoint autenticado
4. a11y-guardian        se tocou template ou estilo
5. corrigir achados     e rodar a suíte de novo
6. git-publisher        branch, commit, push, PR
```

Pular do passo 1 direto ao 6 é como o projeto acumula dívida.

## 1. Portões

```bash
# API
herd php vendor/bin/pint --dirty
herd php vendor/bin/phpstan analyse --memory-limit=512M
herd php artisan test --parallel

# Web
npx prettier --write . && npx eslint . --fix
npm run test
node scripts/check-contrast.mjs
npx playwright test
```

Os três (ou quatro) precisam passar de verdade. "Falha não relacionada" quase nunca é não relacionada.

## 2. Sem segredo, sem artefato

```bash
git diff --cached --name-only | grep -E "^\.env$|\.key$|\.pem$|node_modules|vendor/"
git diff --cached | grep -E "duffel_(test|live)_|sk_live|BEGIN.*PRIVATE KEY"
```

Qualquer acerto interrompe a publicação. Segredo que entra no histórico do Git precisa ser **rotacionado**,
não só removido no commit seguinte.

## 3. Branch e commit

Branch: `<tipo>/<descrição-em-kebab-case>` — `feat/`, `fix/`, `chore/`, `docs/`, `test/`, `refactor/`.
Nunca commite direto na `main`.

Conventional Commits, assunto no imperativo em português, ≤ 72 caracteres:

```
feat(flights): adiciona failover automatico de provider por rate limit

Quando o Duffel responde 429 com ratelimit-reset, o breaker marca o
provider como resfriando ate o timestamp informado e o aggregator segue
para o proximo da cadeia, sem erro visivel ao usuario.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Escopos: `flights`, `auth`, `airports`, `favorites`, `search-ui`, `a11y`, `ci`, `deps`.

`git add` com arquivos explícitos, nunca `git add .` sem conferir `git status`.

## 4. PR

```bash
gh pr create --title "feat(flights): failover automatico de provider" --body "..."
```

Corpo com quatro seções:

**O que muda** — uma frase.
**Por quê** — o problema que resolve.
**Como testar** — comandos concretos que o revisor roda.
**Riscos** — o que pode dar errado.

Se o PR altera `openapi.yaml`, **diga explicitamente** que o outro repo precisa rodar
`npm run sync:api-types`. É a única sincronia entre os repos e esquecer quebra o front.

Feche o corpo com:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Mudança que atravessa os dois repos

Publique na ordem **API primeiro, web depois**. O PR da API entra com o campo novo de forma
retrocompatível; o PR do web consome. Assim nenhum dos dois quebra sozinho em produção.

Referencie um PR no outro pela URL completa — não há link automático entre repos separados.

## Nunca

`git push --force` em branch compartilhada · `--no-verify` · amend de commit publicado · merge do próprio
PR sem o usuário pedir.
