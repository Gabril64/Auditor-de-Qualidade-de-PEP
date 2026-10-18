
from data_extract.core.parser import extract_record_info


class TestExtractRecordInfo:
    def test_extract_all_fields(self):
        mock_record = {
            "Prontuário": "12345",
            "Data De Nascimento pact": "01/01/1980",
            "Idade": "40",
            "Especialidade": "Ortopedia",
            "Data da internação": "10/05/2020",
            "Data de saída": "15/05/2020",
            "Hipóteses Diagnósticas": "Fratura",
            "Especialidade cirurgia": "Ortopedia Cirúrgica",
            "UF cirurgia": "Centro Cirúrgico",
            "Unidade Funcional Internaçao": "Ala Norte",
            "Tipo do registro": "Anamnese",
            "Descricao do registro": "Paciente deu entrada...",
            "Descrição Cirurgica": "Foi realizado procedimento...",
            "Data Inicio Cirurgia": "12/05/2020",
            "Data Fim Cirurgia": "12/05/2020",
            "Cid procedimento": "S72",
            "Procedimento cirurgico Realizado": "Osteossíntese",
            "OPME": "Sim",
            "Categoria Profissional": "Medicina",
            "criacao_registro": "10/05/2020, 14:00"
        }

        expected = {
            "prontuario": "12345",
            "data_nascimento": "01/01/1980",
            "idade": "40",
            "especialidade_internacao": "Ortopedia",
            "periodo_internacao": "10/05/2020",
            "data_saida": "15/05/2020",
            "diagnostico_internacao": "Fratura",
            "especialidade_cirurgia": "Ortopedia Cirúrgica",
            "uf_cirurgia": "Centro Cirúrgico",
            "unidade_funcional": "Ala Norte",
            "tipo_registro": "Anamnese",
            "descricao": "Paciente deu entrada...",
            "descricao_cirurgica": "Foi realizado procedimento...",
            "data_cirurgia": "12/05/2020",
            "fim_cirurgia": "12/05/2020",
            "cid_procedimento": "S72",
            "procedimento_realizado": "Osteossíntese",
            "opme": "Sim",
            "categoria_profissional": "Medicina",
            "data_criacao": "10/05/2020, 14:00"
        }

        result = extract_record_info(mock_record)
        assert result == expected

    def test_extract_missing_fields(self):
        """Empty or missing fields should not raise KeyError and should default to ""."""
        mock_record = {
            "Prontuário": "12345",
            "Data De Nascimento pact": "01/01/1980"
        }

        result = extract_record_info(mock_record)

        assert result["prontuario"] == "12345"
        assert result["data_nascimento"] == "01/01/1980"
        assert result["idade"] == ""
        assert result["descricao"] == ""
        assert result["data_cirurgia"] == ""

    def test_empty_record(self):
        result = extract_record_info({})
        for _key, value in result.items():
            assert value == ""
