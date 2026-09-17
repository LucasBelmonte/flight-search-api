---
name: laravel-endpoint
description: Receita para criar ou alterar um endpoint da API do Flight Search em Laravel 13 - ordem de criação, convenções de validação, formato de erro e o teste Pest que nasce junto. Use ao adicionar rota, controller, action, form request ou API resource no repo flight-search-api.
---

# Endpoint na API do Flight Search

## Ordem obrigatória

O contrato vem primeiro porque o repo do frontend é separado e gera os tipos dele a partir do YAML.

```
1. openapi.yaml       declara path, request, response e códigos de erro
2. migration          se houver tabela nova
3. Model              $fillable explícito, casts, relações
4. FormRequest        validação + authorize()
5. Action             a regra de negócio, método único
6. API Resource       a forma da resposta
7. Controller         fino: valida, delega, devolve
8. rota               routes/api.php, com middleware
9. teste Pest         happy path + validação + autorização
```

## Controller — fino de verdade

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

final class FlightSearchController extends Controller
{
    public function __construct(
        private readonly SearchFlightsAction $searchFlights,
    ) {}

    public function __invoke(SearchFlightsRequest $request): FlightOfferCollection
    {
        $offers = $this->searchFlights->handle(
            FlightSearchCriteria::fromRequest($request),
            $request->user(),
        );

        return FlightOfferCollection::make($offers);
    }
}
```

Se você está escrevendo `if` de regra de negócio no controller, pare — vai para a Action.

## FormRequest

```php
final class SearchFlightsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'origin'      => ['required', 'string', 'size:3', 'uppercase', 'exists:airports,iata_code'],
            'destination' => ['required', 'string', 'size:3', 'uppercase', 'different:origin', 'exists:airports,iata_code'],
            'departure_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'return_date'    => ['nullable', 'date_format:Y-m-d', 'after:departure_date'],
            'adults'   => ['required', 'integer', 'min:1', 'max:9'],
            'children' => ['nullable', 'integer', 'min:0', 'max:8'],
            'cabin'    => ['nullable', Rule::enum(CabinClass::class)],
        ];
    }
}
```

Validar `exists:airports` na origem e destino é de propósito: rejeita lixo **antes** de gastar chamada de
API externa paga.

## Formato único de erro

Toda a API responde erro no mesmo formato — o frontend depende disso:

```json
{
  "error": {
    "code": "PROVIDERS_UNAVAILABLE",
    "message": "Não foi possível consultar voos no momento. Tente novamente em instantes.",
    "details": {}
  }
}
```

Mensagem é para humano e em português. **Nunca** repasse mensagem crua de provider — ela revela
fornecedor, quota e estrutura interna. Registre o detalhe técnico no log, não na resposta.

Códigos em uso: `VALIDATION_FAILED` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`RATE_LIMITED` (429), `PROVIDERS_UNAVAILABLE` (503).

## Rota

```php
Route::prefix('v1')->group(function () {
    Route::post('flights/search', FlightSearchController::class)
        ->middleware(['throttle:flight-search']);        // custa API externa

    Route::middleware('auth:sanctum')->group(function () {
        Route::apiResource('favorites', FavoriteController::class)->only(['index', 'store', 'destroy']);
    });
});
```

O throttle `flight-search` é definido em `AppServiceProvider` por usuário **e** por IP.

## Autorização de recurso do usuário

Nunca busque por ID solto do request:

```php
// ERRADO — IDOR: qualquer usuário deleta favorito de qualquer outro
$favorite = Favorite::findOrFail($request->id);

// CERTO — escopo pelo dono
$favorite = $request->user()->favorites()->findOrFail($id);
```

## Teste que nasce junto

```php
it('busca voos e devolve ofertas ordenadas por preco', function () {
    Http::fake(['api.duffel.com/*' => Http::response(duffelOfferFixture(), 200)]);

    $this->postJson('/api/v1/flights/search', [
        'origin' => 'GRU', 'destination' => 'LIS',
        'departure_date' => now()->addDays(30)->toDateString(),
        'adults' => 1,
    ])
        ->assertOk()
        ->assertJsonStructure(['data' => [['id', 'price', 'itineraries']], 'meta' => ['provider']]);
});

it('rejeita origem igual ao destino', function () {
    $this->postJson('/api/v1/flights/search', [
        'origin' => 'GRU', 'destination' => 'GRU',
        'departure_date' => now()->addDays(30)->toDateString(), 'adults' => 1,
    ])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
});

it('impede acesso a favorito de outro usuario', function () {
    $outro = User::factory()->has(Favorite::factory())->create();

    $this->actingAs(User::factory()->create())
        ->deleteJson("/api/v1/favorites/{$outro->favorites->first()->id}")
        ->assertNotFound();      // 404, não 403 — não revela existência
});
```

## Fechamento

```bash
herd php vendor/bin/pint --dirty
herd php vendor/bin/phpstan analyse --memory-limit=512M
herd php artisan test --parallel
```

E atualize `openapi.yaml` se a forma da resposta mudou — senão o frontend quebra na próxima sincronia.
