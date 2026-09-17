# ADR 0001 — Cadeia de providers com failover automático

**Data:** 2026-09-15
**Status:** aceita

## Contexto

O produto precisa buscar voos no Skyscanner e, quando o rate limit estourar, continuar funcionando pelo
Duffel — sem que o usuário veja erro.

Ao levantar o acesso, dois fatos mudaram o desenho:

1. **A Skyscanner Travel API é exclusiva de parceiros.** Exige ser "an established business with a large
   audience", passa por análise comercial de cerca de duas semanas e **não tem sandbox público**. Não é
   possível desenvolver nem testar contra ela hoje.
2. **O Duffel tem test mode imediato**, com token `duffel_test_`, e documenta o limite de busca em 120
   requisições por 60 segundos, devolvendo `rate_limit_error` e o header `ratelimit-reset`.

O requisito de failover é real e permanece. O que não é viável é fazer o Skyscanner responder agora.

## Decisão

Implementar uma **cadeia de providers ordenada por configuração**, e não uma integração direta com
qualquer fornecedor.

```
FlightSearchAggregator → config('flights.providers') = [skyscanner, duffel, fake]
```

- Todo provider implementa `FlightProvider` e normaliza para os **mesmos DTOs**. A API pública não revela
  a fonte, exceto em `meta.provider`.
- O `SkyscannerProvider` é escrito e ocupa o topo da cadeia, atrás de `FLIGHT_SKYSCANNER_ENABLED=false`.
  Ligar depois é mudar o `.env`.
- Um **circuit breaker** em cache guarda, por provider, o instante de reabertura. Provider resfriando é
  pulado sem requisição HTTP.
- 429, `rate_limit_error`, timeout, 5xx e corpo malformado disparam failover para o próximo. Todos
  falhando: `AllProvidersFailedException` → HTTP 503 padronizado.
- Resultados cacheados por hash dos critérios, TTL de 5 minutos, para poupar quota.

## Consequências

**Boas.** O failover é exercitado desde o primeiro dia, no sentido Duffel → Fake, e os testes provam o
mecanismo sem depender de credencial nenhuma. O CI roda offline com o `FakeProvider`. Adicionar provider é
escrever uma classe e uma linha de config. Se a parceria com a Skyscanner nunca sair, o produto funciona
igual com o Duffel no topo — zero retrabalho.

**Ruins.** Há uma indireção a mais entre o controller e o HTTP. O `SkyscannerProvider` é escrito contra a
documentação, sem execução real, então provavelmente vai precisar de ajuste quando as credenciais
chegarem — por isso a normalização dele fica coberta por testes de unidade com payloads fixos, que é o
máximo de garantia possível sem acesso.

**Atenção.** A chave de cache precisa conter **todos** os critérios de busca. Chave incompleta serve
resultado de uma busca para outra, e é o erro mais fácil de cometer aqui.

## Alternativas descartadas

**Integrar só com o Duffel.** Mais simples, mas joga fora o requisito de failover e cria trabalho de
migração quando a Skyscanner aprovar.

**Usar um agregador não oficial da Skyscanner via RapidAPI.** Contorna a aprovação, mas depende de um
intermediário sem contrato, sem garantia de disponibilidade e de legalidade duvidosa para uso comercial.

**Chamar todos os providers em paralelo e mesclar.** Daria mais cobertura de ofertas, mas multiplica o
custo por busca e a complexidade de desduplicação. Fica registrado como evolução possível, não como v1.
