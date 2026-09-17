---
name: api-contract
description: Como manter o contrato OpenAPI sincronizado entre os dois repositórios do Flight Search - editar openapi.yaml, regenerar tipos TypeScript e validar. Use ao alterar qualquer request ou response da API, ou quando os tipos do frontend não batem com a resposta real.
---

# Contrato OpenAPI entre os dois repos

`flight-search-api` e `flight-search-web` são repositórios independentes. `openapi.yaml`, versionado no
repo da API, é o **único** ponto de sincronia entre eles. Se ele derivar, o front quebra em produção sem
nenhum teste acusar.

## A regra

Contrato primeiro. Sempre.

```
1. edite openapi.yaml no repo da API
2. implemente o backend conforme o contrato
3. teste de contrato passa no CI da API
4. no repo web: npm run sync:api-types
5. implemente o frontend contra os tipos gerados
```

Implementar backend antes de declarar o contrato inverte a dependência e produz um YAML que descreve o
que foi feito em vez de o que foi acordado.

## Sincronizando os tipos no frontend

```bash
npm run sync:api-types
```

O script baixa `openapi.yaml` do repo da API e gera `src/app/core/api/types.ts` com `openapi-typescript`:

```json
{
  "scripts": {
    "sync:api-types": "npx openapi-typescript ../flight-search-api/openapi.yaml -o src/app/core/api/types.ts"
  }
}
```

Se os repos não estiverem lado a lado no disco, troque o caminho pela URL raw do GitHub.

`types.ts` é **gerado** — nunca edite à mão. Edição manual ali é desfeita na próxima sincronia e esconde
a divergência real.

## Usando os tipos

```ts
import type { components } from '@core/api/types';

export type FlightOffer = components['schemas']['FlightOffer'];
export type FlightSearchCriteria = components['schemas']['FlightSearchCriteria'];
```

Nunca escreva à mão uma interface que espelhe resposta da API. Se o tipo que você precisa não existe no
gerado, o contrato está incompleto — corrija o YAML.

## Teste de contrato no CI da API

O CI valida que a resposta real bate com o schema declarado:

```php
it('respeita o contrato OpenAPI na busca de voos', function () {
    Http::fake(['api.duffel.com/*' => Http::response(duffelOfferFixture(), 200)]);

    $this->postJson('/api/v1/flights/search', validCriteria())
        ->assertOk()
        ->assertMatchesOpenApiSchema('openapi.yaml', '/api/v1/flights/search', 'post');
});
```

Toda rota em produção precisa existir no YAML — endpoint não documentado é superfície de ataque esquecida
(OWASP API9).

## Mudança que quebra compatibilidade

Remover campo, renomear campo ou apertar validação quebra o front. Nestes casos:

1. Adicione o campo novo mantendo o antigo.
2. Migre o frontend.
3. Só então remova o antigo, em um PR separado.

O PR que altera `openapi.yaml` **precisa** dizer no corpo que o outro repo deve rodar
`npm run sync:api-types`. Sem esse aviso, a mudança passa despercebida até quebrar.

## Estrutura do arquivo

```yaml
openapi: 3.1.0
info: { title: Flight Search API, version: 1.0.0 }
paths:
  /api/v1/flights/search: { post: ... }
  /api/v1/airports:       { get: ... }     # busca local, não gasta API externa
  /api/v1/auth/login:     { post: ... }
  /api/v1/favorites:      { get: ..., post: ... }
components:
  schemas:
    FlightSearchCriteria: ...
    FlightOffer: ...
    Itinerary: ...
    Segment: ...
    Error: ...        # formato único de erro em toda a API
```
