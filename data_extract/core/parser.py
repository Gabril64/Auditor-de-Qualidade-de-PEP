def extract_record_info(record):
    """Extract relevant information from a record based on its type"""
    info = {
        "prontuario": record.get("Prontuário", ""),
        "data_nascimento": record.get("Data De Nascimento pact", ""),
        "idade": record.get("Idade", ""),
        "especialidade_internacao": record.get("Especialidade", ""),
        "periodo_internacao": record.get("Data da internação", ""),
        "data_saida": record.get("Data de saída", ""),
        "diagnostico_internacao": record.get("Hipóteses Diagnósticas", ""),
        "especialidade_cirurgia": record.get("Especialidade cirurgia", ""),
        "uf_cirurgia": record.get("UF cirurgia", ""),
        "unidade_funcional": record.get("Unidade Funcional Interna\u00e7ao", ""),
        "tipo_registro": record.get("Tipo do registro", ""),
        "descricao": record.get("Descricao do registro", ""),
        "descricao_cirurgica": record.get("Descrição Cirurgica", ""),
        "data_cirurgia": record.get("Data Inicio Cirurgia", ""),
        "fim_cirurgia": record.get("Data Fim Cirurgia", ""),
        "cid_procedimento": record.get("Cid procedimento", ""),
        "procedimento_realizado": record.get("Procedimento cirurgico Realizado", ""),
        "opme": record.get("OPME", ""),
        "categoria_profissional": record.get("Categoria Profissional", ""),
        "data_criacao": record.get("criacao_registro", ""),
    }
    return info
