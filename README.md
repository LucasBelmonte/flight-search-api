# Flight Search API

API de busca de passagens aéreas. Laravel 13, PHP 8.4, Sanctum em modo SPA.

Consome uma **cadeia de providers com failover automático**: quando o provider primário estoura o rate
limit, o próximo assume sem que o usuário final veja erro.

> **Estado atual:** este repositório contém o contrato (`openapi.yaml`), as decisões de arquitetura
> (`docs/adr/`) e a configuração de agentes e hooks. O código Laravel ainda não foi gerado porque depende
> do PHP — rode o bootstrap abaixo depois de instalar o Herd.

## Pré-requisitos

1. **[Laravel Herd para Windows](https://herd.laravel.com/windows)** — traz PHP 8.4 e Composer.
   Fixe o PHP em **8.4**: o Laravel 13 exige 8.3 ou superior, e o 8.5 no Herd ainda é alpha.
2. **Token do Duffel** em modo teste — crie em [app.duffel.com](https://app.duffel.com), seção Developer
   test mode. O token começa com `duffel_test_`.

## Bootstrap

Depois de instalar o Herd, na raiz deste repositório:

```powershell
.\scripts\bootstrap.ps1
```

O script gera o esqueleto Laravel **sem sobrescrever** os arquivos que já estão aqui, instala Pest,
Larastan e Sanctum, e cria o banco SQLite de desenvolvimento.

## Comandos

```powershell
herd php artisan serve                    # ou http://flight-search-api.test pelo Herd
herd php artisan test --parallel          # suíte completa
herd php artisan test --coverage --min=80 --filter=Flights
herd php vendor/bin/pint --dirty          # formatação
herd php vendor/bin/phpstan analyse       # análise estática
```

## A cadeia de providers

```
FlightSearchAggregator
  └─ tenta, na ordem de config('flights.providers'):
       skyscanner   desligado — ver abaixo
       duffel       test mode ativo
       fake         sempre disponível; o único usado em CI
```

**Sobre o Skyscanner.** A Travel API deles é exclusiva de parceiros aprovados: exige empresa estabelecida
com audiência grande, passa por análise comercial de cerca de duas semanas e **não oferece sandbox
público**. O `SkyscannerProvider` está implementado e ocupa o topo da cadeia, mas fica atrás de
`FLIGHT_SKYSCANNER_ENABLED=false`. Quando as credenciais chegarem, ligar é mudar o `.env` — nenhuma
alteração de código.

**Failover.** Ao receber HTTP 429 ou um corpo com `rate_limit_error`, o provider lê o header
`ratelimit-reset`, registra um circuit breaker no cache até aquele instante e lança
`ProviderRateLimitedException`. O aggregator captura, emite `ProviderFailedOver` e passa ao próximo.
Timeout, 5xx e resposta malformada seguem o mesmo caminho. Se todos falharem: HTTP 503 com corpo
padronizado.

Enquanto o breaker está aberto, o provider é **pulado sem requisição HTTP** — não adianta gastar quota
para receber 429 de novo.

### Testando o failover à mão

```dotenv
FLIGHT_PROVIDERS=duffel,fake
DUFFEL_FORCE_RATE_LIMIT=true
```

Faça uma busca e confirme no log a linha `ProviderFailedOver`, com os resultados vindo do `fake` e sem
erro visível na tela.

## Contrato

`openapi.yaml` é a fonte da verdade e **muda antes do código**. O repositório do frontend gera os tipos
TypeScript dele a partir deste arquivo:

```bash
# no repo flight-search-web
npm run sync:api-types
```

Todo PR que altera o contrato precisa dizer isso no corpo — é a única sincronia entre os dois repos.

## Segurança

- **Sanctum em modo SPA**: cookie de sessão httpOnly + CSRF. Nenhum token vai no corpo da resposta, porque
  token acessível a JavaScript é exfiltrável por XSS.
- Segredos só via `config()`. Nunca `env()` fora de `config/` — quebra com config cache.
- `/flights/search` tem throttle por usuário **e** por IP: cada chamada custa quota externa paga.
- Recursos de usuário sempre escopados pelo dono (`$request->user()->favorites()`), nunca por ID solto
  do request.
- Resposta de provider é entrada não confiável: validada antes de normalizar, nunca repassada crua.

## Estrutura

```
openapi.yaml              contrato — muda primeiro
docs/adr/                 decisões de arquitetura
.claude/settings.json     hooks de qualidade e segurança
.claude/hooks/            os scripts que os hooks executam
scripts/bootstrap.ps1     gera o esqueleto Laravel
```
