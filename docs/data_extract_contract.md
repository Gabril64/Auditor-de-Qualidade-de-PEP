# Contrato de Integração - Motor de Auditoria (`data_extract`)

Esta documentação define o contrato de comunicação com o módulo Python de extração e auditoria de prontuários (`data_extract/main.py`). O script funciona recebendo dados na entrada padrão (`sys.stdin`) e devolvendo os resultados pela saída padrão (`sys.stdout`).

---

## 📥 1. Formato de Entrada (Input)

O script espera receber um **Array de Objetos JSON**, onde cada objeto representa **um único registro/documento** do prontuário do paciente (ex: uma Anamnese ou uma Evolução). Diferentes registros do mesmo paciente devem compartilhar o mesmo `"Prontuário"`.

### Schema Esperado (Exemplo de Campos Mapeados)

```json
[
  {
    "Prontuário": "13.696.539",
    "Data De Nascimento pact": "17/11/1960",
    "Idade": "63 ANOS",
    "Especialidade": "CIRURGIA GERAL",
    "Data da internação": "19/11/2023, 08:49",
    "Data de saída": "21/11/2023, 15:29",
    "Hipóteses Diagnósticas": "",
    "Especialidade cirurgia": "CIRURGIA GERAL",
    "UF cirurgia": "BLOCO CIRURGICO",
    "Unidade Funcional Internaçao": "8º NORTE",
    
    "Categoria Profissional": "MEDICINA",
    "Tipo do registro": "Anamnese",
    "criacao_registro": "19/11/2023, 10:47",
    "Descricao do registro": "TEXTO LIVRE DA ANAMNESE OU EVOLUÇÃO AQUI...",
    
    "Descrição Cirurgica": "TEXTO DA DESCRIÇÃO CIRÚRGICA...",
    "Data Inicio Cirurgia": "20/11/2023, 15:05",
    "Data Fim Cirurgia": "20/11/2023, 16:50",
    "Cid procedimento": "",
    "Procedimento cirurgico Realizado": "HERNIOPLASTIA INCISIONAL",
    "OPME": ""
  }
]
```

> [!IMPORTANT]
> - O script consolida automaticamente registros com o mesmo número de `"Prontuário"`.
> - A data do documento é extraída da chave `"criacao_registro"`.
> - As chaves não mapeadas no parser serão ignoradas.

---

## 📤 2. Formato de Saída (Output)

O script retorna um **Array de Objetos JSON** impresso no console (`sys.stdout`). Cada objeto na lista corresponde a um **paciente agrupado** com a auditoria completa.

### Schema Retornado

```json
[
  {
    "record_id": "13.696.539",
    "audit_data": {
      
      "matriz_documentos": {
        "datas": ["19/11/2023", "20/11/2023", "21/11/2023"],
        "matriz": {
          "MEDICINA - Anamnese": {
            "19/11/2023": 1
          },
          "ENFERMAGEM - Evolução": {
            "20/11/2023": 1,
            "21/11/2023": 1
          }
        }
      },

      "secao_a": {
        "prontuario": "13.696.539",
        "data_nascimento": "17/11/1960",
        "idade": "63 ANOS",
        "especialidade_internacao": "CIRURGIA GERAL",
        "periodo_internacao": "19/11/2023, 08:49 - 21/11/2023, 15:29 (2 dias)",
        "diagnostico_internacao": "Não registrado",
        "especialidade_cirurgia": "CIRURGIA GERAL",
        "unidade_funcional": "8º NORTE"
      },

      "secao_b_anamnese": {
        "hda": "conforme",
        "hd_cid": "conforme",
        "ap_app": "conforme",
        "af": "conforme",
        "exame_fisico": "conforme (estado geral)",
        "cd": "conforme",
        "criacao_anamnese": "conforme"
      },

      "secao_b_evolucao": {
        "hd_cid": "conforme",
        "exame_fisico": "conforme (estado geral)",
        "procedimentos_condutas_queixas": "conforme",
        "frequencia_diaria": "conforme"
      },

      "secao_c": {
        "tem_cirurgia": true,
        "especialidade": "CIRURGIA GERAL",
        "unidade_funcional": "BLOCO CIRURGICO",
        "inicio": "20/11/2023, 15:05",
        "fim": "20/11/2023, 16:50",
        "diagnostico_cid": "Não registrado",
        "descricao_procedimento": "HERNIOPLASTIA INCISIONAL",
        "descricao_tecnica": "conforme",
        "uso_opme": "conforme (tela, dreno)"
      },

      "secao_d_anamnese": {
        "motivo_internacao": "conforme",
        "ap_app": "conforme",
        "af": "Não registrado",
        "exame_fisico": "conforme (estado geral, pele/mucosas)",
        "escala_braden": "conforme",
        "escala_morse": "conforme",
        "cd": "conforme",
        "criacao_anamnese": "conforme"
      },

      "secao_d_evolucao": {
        "motivo_internacao": "conforme",
        "exame_fisico": "conforme (estado geral, pele/mucosas)",
        "condutas": "conforme",
        "escala_braden": "conforme",
        "escala_morse": "conforme",
        "criacao_evolucao": "conforme",
        "curativo": "Não se aplica"
      },

      "secao_e": {
        "tem_outras_categorias": true,
        "categorias": {
          "Fisioterapia/Terapia Ocupacional": { "anamnese": "Não se aplica", "evolucao": "Não se aplica" },
          "Nutrição": { "anamnese": "Não se aplica", "evolucao": "Não se aplica" },
          "Psicologia": { "anamnese": "Não se aplica", "evolucao": "Não se aplica" },
          "Fonoaudiologia": { "anamnese": "Não se aplica", "evolucao": "Não se aplica" },
          "Serviço Social": { "anamnese": "conforme", "evolucao": "Não se aplica" },
          "Farmácia": { "anamnese": "Não se aplica", "evolucao": "Não se aplica" }
        }
      },

      "conformity_a": {
        "total": 8,
        "valid": 7,
        "percent": 87.5
      },
      "conformity_b_anamnese": { "total": 7, "valid": 7, "percent": 100.0 },
      "conformity_b_evolucao": { "total": 4, "valid": 4, "percent": 100.0 },
      "conformity_c": { "total": 8, "valid": 7, "percent": 87.5, "applies": true },
      "conformity_d_anamnese": { "total": 8, "valid": 7, "percent": 87.5 },
      "conformity_d_evolucao": { "total": 6, "valid": 6, "percent": 100.0 },
      "conformity_e": { "total": 1, "valid": 1, "percent": 100.0, "applies": true, "categoria": "Fisioterapia/Terapia Ocupacional, Nutrição, Psicologia, Fonoaudiologia, Serviço Social, Farmácia" },

      "conformity_global": {
        "total": 42,
        "valid": 39,
        "invalid": 3,
        "percent": 92.85714285714286
      }
    }
  }
]
```

> [!NOTE]
> Valores que não são preenchidos corretamente no prontuário aparecerão com as strings `"Não registrado"`. Caso o item não seja obrigatório e não exista preenchimento, aparecerá como `"Não se aplica"`.
