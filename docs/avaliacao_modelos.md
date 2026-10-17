# Como rodar a avaliação de modelos

Guia para executar o notebook [`evaluation/notebooks/avaliacao_modelos.ipynb`](../evaluation/notebooks/avaliacao_modelos.ipynb) do começo ao fim: preparar o ambiente, autenticar, rodar e registrar a configuração da máquina.

O notebook não fala direto com o modelo. Ele envia os prontuários ao Producer, que os enfileira para o Worker, e o Worker audita cada um chamando o LM Studio:

```text
notebook ──► Producer :3001 ──► Redis ──► Worker ──► LM Studio :1234
   ▲                                                       │
   └───────────── consulta o resultado de cada job ◄───────┘
```

## 1. Pré-requisitos

| Item | O que precisa estar pronto |
| --- | --- |
| **LM Studio** | Instalado, com o **servidor local ligado** na porta `1234` (aba *Developer* → *Start Server*, ou `lms server start`). |
| **Modelos** | Baixados e **carregados** no LM Studio, com os mesmos identificadores da lista `ALL_MODELS` do notebook (hoje `qwen2.5-3b-instruct`, `phi-4-mini-instruct` e `llama-3.2-3b-instruct`). Confira com `lms ps`. |
| **Docker** | Docker Desktop (no Windows) **em execução**, com o comando `docker compose` disponível. |
| **Python 3.13** | Para o kernel do notebook. Pode ser um venv na raiz do repositório. |
| **Jupyter / VS Code** | Com a extensão de notebooks e o kernel do venv selecionado. |
| **Repositório clonado** | Os dados de entrada (`data/prontuarios.json` e `data/gabarito.csv`) já vêm versionados. |

Ao carregar os modelos, use **o mesmo contexto em todos** (o desenvolvimento usou `8192`) e anote o número de camadas em GPU (*GPU Offload*). Esses valores mudam o resultado e precisam constar no relatório, ver o passo 6.

Para criar o venv no Windows, a partir da raiz do repositório:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install ipykernel
```

As demais bibliotecas (`requests`, `python-dotenv`, `pandas`, `scikit-learn`, `matplotlib`, `seaborn`) são instaladas pela primeira célula do notebook.

## 2. Autenticação: token de serviço

Todas as rotas do Producer, exceto `/health` e o login, exigem autenticação. O notebook não faz login: ele manda um **token de serviço** no header `X-Api-Token`.

Gere um token e grave-o em um arquivo `.env` **na raiz do repositório** (o arquivo é ignorado pelo git):

```powershell
$token = python -c "import secrets; print(secrets.token_hex(32))"
Set-Content -Path .env -Value "EVAL_API_TOKEN=$token" -Encoding ascii
```

Se o `.env` já existir com outras variáveis, acrescente a linha em vez de sobrescrever:

```powershell
Add-Content -Path .env -Value "EVAL_API_TOKEN=$token" -Encoding ascii
```

Escreva o valor **sem aspas**. O mesmo arquivo é lido por dois lados: pelo `docker compose`, que entrega o token ao Producer, e pelo notebook, que o envia em cada requisição. Os dois precisam ter exatamente o mesmo valor.

> **Atenção:** quem tem o token consegue enviar lotes e ler resultados do Producer. Não o versione e não o cole em mensagens.

## 3. Subir a stack

Na raiz do repositório:

```powershell
docker compose up -d --build
docker compose ps
```

Devem aparecer três serviços em execução: `redis`, `worker` e `producer`.

Confirme que o Producer reconheceu o token:

```powershell
docker compose logs producer | Select-String "Seed"
```

A saída esperada contém `Service account created for EVAL_API_TOKEN: evaluation@auditor.local` (na primeira vez) ou `Service account already exists` (nas seguintes). Se não aparecer nenhuma das duas, o Producer subiu sem o token. Confira o `.env` e rode `docker compose up -d producer` de novo.

Depois, confirme que o Worker **enxerga o LM Studio** de dentro do container:

```powershell
docker compose exec worker python -c "import urllib.request as u; print(u.urlopen('http://host.docker.internal:1234/v1/models').status)"
```

Deve imprimir `200`. Se falhar, ligue a opção *Serve on Local Network* nas configurações do servidor do LM Studio e tente de novo.

> Não altere o `LMSTUDIO_URL` do worker no `docker-compose.yml`. Ele precisa apontar para `/v1/chat/completions`: a rota própria do LM Studio (`/api/v1/chat`) recusa o parâmetro `seed`, e o notebook rejeita qualquer auditoria em que a semente não tenha sido aplicada.

## 4. Escolher N_PATIENTS e N_REPETITIONS

São duas variáveis no notebook:

| Variável | Onde fica | O que controla |
| --- | --- | --- |
| `N_PATIENTS` | Seção **2** (*Load ground truth and test records*) | Quantos prontuários avaliar. O máximo é o número de prontuários únicos do gabarito, impresso na seção 2 (11 na versão atual). |
| `N_REPETITIONS` | Seção **1** (*Setup and imports*) | Quantas vezes cada modelo audita cada prontuário. |

O tempo total cresce com o produto **prontuários × modelos × repetições**. Na máquina de desenvolvimento (CPU, cerca de 4 tokens por segundo), um prontuário levou aproximadamente 130 s por modelo. Meça o tempo na máquina de avaliação com uma rodada pequena antes de planejar a completa.

Duas rodadas com objetivos diferentes:

| Objetivo | `N_PATIENTS` | `N_REPETITIONS` |
| --- | --- | --- |
| **Verificar a reprodutibilidade** | 2 ou 3 | 3 |
| **Avaliação completa dos modelos** | o máximo do gabarito | 1 |

Com `N_REPETITIONS` maior que 1, o notebook compara as repetições de cada prontuário. Se duas execuções do mesmo prontuário diferirem em um único byte, ele para e lista quais. Quando todas coincidem, imprime `[ok] reproducibility verified`.

## 5. Executar o notebook

1. Abra o notebook com o diretório de trabalho em `evaluation/notebooks`. O VS Code já faz isso por padrão, e o notebook usa caminhos relativos (`data/`).
2. Selecione o kernel do venv.
3. Rode as células em ordem (*Run All*).

Pontos de controle durante a execução:

- A célula de login (seção 4) imprime `Authenticated as evaluation@auditor.local`. Se ela falhar, o problema é o token, ver a seção 8.
- A seção 5 mostra o progresso de cada modelo e de cada lote.
- Um aviso `[!] ... did not answer N field(s)` **não é erro**: o modelo respondeu fora do formato pedido, e isso é registrado como resultado dele.
- Um aviso `[~] ... differently spelled key` também não é erro: a chave da resposta só diferia por acento ou caixa e foi reconhecida.
- A seção 5.1 confere que os três modelos receberam os mesmos campos.

> **Os resultados anteriores são sobrescritos.** Os arquivos em `data/results/` são versionados. O notebook substitui as linhas dos modelos de `ALL_MODELS` e mantém as dos outros. Se quiser guardar a rodada anterior, faça commit ou copie a pasta **antes** de rodar de novo.

## 6. Registrar o ambiente de execução

Com o LM Studio ainda aberto e os **modelos ainda carregados**, rode na raiz do repositório:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\coletar-ambiente.ps1
```

O script lê só configuração, nunca prontuários, e grava em `evaluation/notebooks/data/results/`:

- `ambiente.json`: o registro completo, incluindo a saída bruta de cada comando.
- `ambiente.md`: a tabela pronta para a metodologia.

Ele coleta a versão do LM Studio; o motor de inferência em uso (o `llama.cpp-...@versão`); para cada modelo carregado, o arquivo GGUF, a quantização, o contexto e o **SHA-256 dos pesos**; CPU, memória, GPU e driver; sistema operacional; versão do Docker; commit do repositório; e a decodificação que o Worker está usando.

Opções:

- `-SkipHash` pula o SHA-256, que lê o arquivo de pesos inteiro (alguns GB por modelo).
- `-OutDir <pasta>` muda onde os arquivos são gravados.

Dois itens o script **não consegue ver** e você precisa anotar à mão:

- **GPU Offload** (camadas na GPU): fica na interface do LM Studio, em *My Models* → o modelo → painel de carregamento.
- **Qualquer campo que saia como `não detectado`**: o motivo vem entre parênteses, e a saída bruta fica no JSON.

> O script foi escrito sem acesso a um PowerShell e ainda não foi executado no Windows. Se algum campo vier errado ou vazio, ajuste à mão e corrija o script.

## 7. O que a execução produz

Em `evaluation/notebooks/data/results/`:

| Arquivo | Conteúdo |
| --- | --- |
| `raw_results.csv` | Uma linha por (modelo, repetição, prontuário, seção, campo), com a assinatura da IA (`ai_outcome`). |
| `ia_meta.csv` | Uma linha por (modelo, repetição, prontuário): decodificação, semente, `fingerprint` da auditoria, campos enviados/respondidos/nulos/com erro, `keys_normalized` e `error_fields`. É a evidência documental da reprodutibilidade. |
| `quality_metrics_by_field.csv` | Precision, recall e F1 por modelo e por campo. |
| `final_summary.csv` | Tabela consolidada por modelo. |
| `latency_metrics.csv`, `latency_boxplot.png` | Latência por modelo. |
| `confusion_matrices.png` | Matrizes de confusão (binária e de 3 classes: conforme, incompleto e ausente). |
| `ambiente.json`, `ambiente.md` | Configuração da máquina (passo 6). |

## 8. Quando algo para

| Mensagem | Causa e solução |
| --- | --- |
| `EVAL_API_TOKEN is in neither the environment nor ...` | O `.env` não existe na raiz do repositório ou não tem a chave `EVAL_API_TOKEN`. Refaça o passo 2. |
| `The Producer rejected the service token (401)` com `Service token authentication is disabled` | O Producer subiu sem o token. Confira o `.env` e rode `docker compose up -d producer`. |
| `... (401)` com `Invalid service token` | O token do `.env` é diferente do que o Producer recebeu. Recrie o Producer com `docker compose up -d --force-recreate producer`. |
| `... does not exist or is inactive` | A conta de serviço sumiu ou foi desativada. Reinicie o Producer para recriá-la. |
| `Connection refused` em `localhost:3001` | O Docker não está de pé. Rode `docker compose up -d`. |
| `the seed was not applied` | O Worker está apontando para a rota errada do LM Studio. Veja a nota do passo 3 e recrie o Worker com `docker compose up -d --force-recreate worker`. |
| `decoding is 'amostragem' ... NOT reproducible` | `AI_TEMPERATURE`, `AI_TOP_K` ou `AI_TOP_P` foram alterados no ambiente. Remova a alteração; o padrão é `0`, `1` e `1`. |
| `the AI could not be reached for [...]` | `timeout` ou `http_error`: o LM Studio está desligado, sem o modelo carregado ou sobrecarregado. Nada foi medido sobre o modelo, então a execução aborta. Corrija o LM Studio e rode de novo. |
| `the same records produced DIFFERENT audits across repetitions` | A reprodutibilidade falhou. Verifique se algo mudou no LM Studio entre as repetições (modelo, contexto, camadas em GPU, motor) e compare com `ambiente.json`. |
| A seção 5 fica esperando e não termina | O job não está sendo consumido. Veja `docker compose logs worker`. |

## 9. Como a reprodutibilidade é garantida

A semente (`SEED = 42`) é enviada ao modelo em toda requisição e gravada na assinatura de cada auditoria (`_ia_meta`). Mas a semente sozinha **não** garante resultados idênticos: ela só fixa o sorteio. O que elimina a variação é a **decodificação gulosa**, aplicada pelo Worker com `temperature = 0`, `top_k = 1` e `top_p = 1`.

O notebook recusa qualquer auditoria em que a semente não tenha sido aplicada ou a decodificação não seja gulosa, e o `fingerprint` do `ia_meta.csv` permite comparar auditorias byte a byte.

O determinismo é propriedade do ambiente, não só dos parâmetros. Mudar o modelo, a quantização, o motor de inferência, o contexto ou as camadas em GPU invalida a comparação entre execuções. É por isso que o passo 6 existe.
