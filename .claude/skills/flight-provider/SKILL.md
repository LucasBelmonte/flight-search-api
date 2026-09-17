---
name: flight-provider
description: Como funciona e como alterar a cadeia de providers de voo do Flight Search - Skyscanner, Duffel e Fake, com circuit breaker e failover automático por rate limit. Use ao adicionar provider, depurar failover, mexer em cache de busca ou testar cenário de 429.
---

# Cadeia de providers de voo

## O desenho

```
FlightSearchAggregator
  └─ percorre config('flights.providers') em ordem:
       skyscanner   flag off — sem credenciais de parceiro ainda
       duffel       test mode ativo (token duffel_test_*)
       fake         sempre disponível; o único usado em CI
```

O aggregator tenta cada provider em ordem. O primeiro que responder com sucesso ganha. O usuário final
nunca vê um erro só porque a fonte primária ficou indisponível — esse é o requisito central do produto.

## Estado do Skyscanner (leia antes de mexer)

A Skyscanner Travel API é **exclusiva de parceiros aprovados**: exige empresa estabelecida com audiência
grande, passa por análise comercial de cerca de duas semanas e **não tem sandbox público**. O
`SkyscannerProvider` existe e está no topo da cadeia, mas atrás de `FLIGHT_SKYSCANNER_ENABLED=false`.

Não escreva teste que dependa de resposta real dele. Quando as credenciais chegarem, ligar é mudar o
`.env` — nenhuma mudança de código.

## A interface

```php
interface FlightProvider
{
    public function name(): string;

    /** @throws ProviderRateLimitedException|ProviderUnavailableException */
    public function search(FlightSearchCriteria $criteria): FlightOfferCollection;
}
```

Todo provider normaliza para os **mesmos DTOs** (`FlightOffer`, `Itinerary`, `Segment`). A resposta pública
não revela a fonte, exceto `meta.provider`.

## Detecção de rate limit

```php
if ($response->status() === 429 || $response->json('errors.0.type') === 'rate_limit_error') {
    $resetAt = $response->header('ratelimit-reset')
        ? Carbon::createFromTimestamp((int) $response->header('ratelimit-reset'))
        : now()->addSeconds(config('flights.breaker.default_cooldown'));

    $this->breaker->open($this->name(), $resetAt);

    throw new ProviderRateLimitedException($this->name(), $resetAt);
}
```

O Duffel expõe `ratelimit-reset` e o limite padrão de busca é 120 requisições por 60 segundos. Quando o
header não vier, use o cooldown de config — nunca assuma um valor no código.

## Circuit breaker

Chave de cache `flights:breaker:{provider}` guardando o timestamp de reabertura. Antes de chamar um
provider, o aggregator consulta o breaker: se estiver aberto, **pula sem fazer requisição HTTP**. Isso
evita queimar quota pedindo para levar 429 de novo.

## Adicionando um provider novo

1. Crie `app/Services/Flights/MeuProvider.php` implementando `FlightProvider`.
2. Normalize a resposta para os DTOs existentes — **não** crie DTO paralelo.
3. Registre em `config/flights.php`, com URL base, timeouts e flag próprios.
4. Adicione ao array `providers` na posição desejada da cadeia.
5. Escreva os quatro testes de falha (abaixo). Sem eles o provider não entra.

Nunca leia credencial com `env()` fora de `config/` — quebra quando o config está em cache.

## Os testes obrigatórios de todo provider

```php
it('faz failover quando o primario estoura o rate limit', function () {
    Http::fake([
        'api.duffel.com/*' => Http::response(
            ['errors' => [['type' => 'rate_limit_error']]],
            429,
            ['ratelimit-reset' => now()->addMinute()->timestamp],
        ),
    ]);
    Event::fake([ProviderFailedOver::class]);

    $response = $this->postJson('/api/v1/flights/search', validCriteria());

    $response->assertOk();                                  // usuário não vê erro
    expect($response->json('meta.provider'))->toBe('fake');
    Event::assertDispatched(ProviderFailedOver::class);
});

it('pula provider com breaker aberto sem chamada HTTP', function () {
    app(CircuitBreaker::class)->open('duffel', now()->addMinute());
    Http::fake();

    $this->postJson('/api/v1/flights/search', validCriteria())->assertOk();

    Http::assertNothingSent();
});

it('faz failover em timeout', function () {
    Http::fake(fn () => throw new ConnectionException('timeout'));
    $this->postJson('/api/v1/flights/search', validCriteria())->assertOk();
});

it('responde 503 padronizado quando todos falham', function () {
    config(['flights.providers' => ['duffel']]);
    Http::fake(['api.duffel.com/*' => Http::response([], 500)]);

    $this->postJson('/api/v1/flights/search', validCriteria())
        ->assertStatus(503)
        ->assertJsonPath('error.code', 'PROVIDERS_UNAVAILABLE');
});
```

`Http::preventStrayRequests()` fica no `Pest.php`: nenhum teste toca a rede de verdade.

## Cache de busca

Resultado cacheado por hash dos critérios, TTL de 5 minutos (`config('flights.cache.ttl')`). Isso reduz
muito o consumo de quota. A chave inclui **todos** os critérios — origem, destino, datas, passageiros e
cabine. Chave incompleta serve resultado errado para outra busca, e é o bug mais fácil de cometer aqui.

## Teste manual do failover

```bash
# .env
FLIGHT_PROVIDERS=duffel,fake
DUFFEL_FORCE_RATE_LIMIT=true
```

Faça uma busca e confirme no log a linha `ProviderFailedOver` com os resultados vindo do `fake` — sem erro
visível na tela.
