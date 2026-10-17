# GET /records/:number/status

Consulta de forma assíncrona se um determinado prontuário já teve sua auditoria finalizada pelo *Worker* e extrai o relatório.

- **Endpoint:** `GET /records/:number/status`
- **Parâmetro da URL:** `:number` é o número do prontuário (pode conter pontos, ex: `19.265.867`, pois a API fará a limpeza automática).

> **Atenção:** esta rota devolve o resultado **mais recente** gravado para o prontuário, de **qualquer lote ou modelo**. Se o mesmo prontuário for enviado várias vezes (por exemplo, para comparar modelos), o resultado anterior é sobrescrito. Para consultar o resultado de um envio específico, use o `job_id` retornado por `POST /batches` em [`GET /jobs/:id/status`](get_jobs_status.md).

## Resposta: Em Processamento
Enquanto o *Worker* (Python) ainda está executando a extração ou o item aguarda na fila.

- **Status:** `202 Accepted`
- **Body:**
```json
{
  "status": "processing",
  "record_number": "19265867"
}
```

## Resposta: Processamento Concluído
Quando a auditoria finaliza, os resultados estruturados são retornados na chave `result`. (Para ver a fundo a tipagem do conteúdo dentro do `audit_data`, consulte o contrato do extrator em `data_extract_contract.md`).

- **Status:** `200 OK`
- **Body:**
```json
{
  "status": "done",
  "result": {
    "record_id": "19.265.867",
    "audit_data": {
      "matriz_documentos": { "datas": [], "matriz": {} },
      "secao_a": { },
      "secao_b_anamnese": { },
      "conformity_global": {
        "total": 42,
        "valid": 39,
        "invalid": 3,
        "percent": 92.85
      }
    }
  }
}
```

## Erros Comuns
- `500 Internal Server Error`: Falha ao comunicar com o Redis na hora de buscar a chave de resultado.

## Autenticação

Todas as rotas, exceto `GET /health` e `POST /api/auth/login`, exigem autenticação. Há dois caminhos:

| Caminho | Como | Para quem |
| --- | --- | --- |
| Sessão | Cookie `session` obtido em `POST /api/auth/login`, mais o header `X-CSRF-Token` nos métodos que alteram estado (`POST`, `PUT`, `PATCH`, `DELETE`) | A interface web e qualquer uso interativo |
| Token de serviço | Header `X-Api-Token` com o valor de `EVAL_API_TOKEN`. Sem cookie e sem CSRF | Scripts e programas não interativos (o notebook de avaliação de modelos) |

O token de serviço só existe enquanto `EVAL_API_TOKEN` estiver definido no ambiente do Producer — sem essa variável, o header não autentica nada. As requisições feitas com ele agem como a conta `evaluation@auditor.local`, criada no *seed* e com perfil de **auditor**: pode enviar lotes e ler resultados, mas não apagar nem restaurar auditorias. Os lotes continuam atribuídos a ela no `access_log`.

```bash
curl -X POST "http://localhost:3001/batches?model=phi-4&seed=42" \
  -H "X-Api-Token: $EVAL_API_TOKEN" \
  --data-binary @registros.txt
```

**Respostas de falha:** `401` sem credencial, com token inválido ou com a conta de serviço inexistente/inativa; `403` com CSRF inválido, com senha de primeiro acesso pendente, ou quando a rota exige perfil de administrador.
