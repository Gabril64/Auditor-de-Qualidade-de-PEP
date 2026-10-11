import pytest

from data_extract.utils.helpers import (
    calculate_age,
    check_complete_physical_exam,
    check_dressing,
    format_period,
)


class TestCalculateAge:
    def test_valid_dates(self):
        assert calculate_age("15/05/1990", "15/05/2020") == "30 ANOS"
        assert calculate_age("16/05/1990", "15/05/2020") == "29 ANOS"

    def test_with_time_component(self):
        assert calculate_age("15/05/1990, 10:00", "15/05/2020, 14:00") == "30 ANOS"

    def test_empty_dates(self):
        assert calculate_age("", "15/05/2020") == ""
        assert calculate_age("15/05/1990", None) == ""

    def test_invalid_format(self):
        assert calculate_age("1990-05-15", "2020-05-15") == ""

class TestFormatPeriod:
    def test_valid_period(self):
        assert format_period("10/05/2020, 10:00", "15/05/2020, 10:00") == "10/05/2020, 10:00 - 15/05/2020, 10:00 (5 dias)"

    def test_missing_admission(self):
        assert format_period("", "15/05/2020, 10:00") == "Não registrado"
        assert format_period(None, "15/05/2020, 10:00") == "Não registrado"

    def test_missing_discharge(self):
        assert format_period("10/05/2020, 10:00", "") == "10/05/2020, 10:00 - Data de saída não registrada"

    def test_invalid_format(self):
        assert format_period("10/05/2020", "15/05/2020") == "10/05/2020 - 15/05/2020"

class TestCheckCompletePhysicalExam:
    @pytest.fixture
    def mock_dict(self):
        return {
            "respiratorio": ["murmúrio vesicular", "eupneico"],
            "cardiovascular": ["ritmo cardíaco regular", "rcr"]
        }

    def test_all_systems_present(self, mock_dict):
        text = "Paciente eupneico, rcr em 2 tempos."
        assert check_complete_physical_exam(text, mock_dict) == "conforme"

    def test_missing_systems(self, mock_dict):
        text = "Paciente eupneico, abdome flácido."
        assert check_complete_physical_exam(text, mock_dict) == "não conforme (Faltam: cardiovascular)"

    def test_empty_text(self, mock_dict):
        assert check_complete_physical_exam("", mock_dict) == "Não registrado"

class TestCheckDressing:
    """Dressing: type (simples/especial/grau II) next to the word 'curativo' + size, exudate and necrosis."""

    def test_valid_dressing(self):
        text = "Foi realizado curativo simples, tamanho pequeno, com pouco exsudato e sem presença de necrose."
        assert check_dressing(text) == "conforme (Curativo simples)"

    def test_type_found_but_details_missing(self):
        text = "Feito curativo simples na ferida operatória."
        assert check_dressing(text) == "não conforme (Curativo simples; faltou: tamanho, exsudato, necrose)"

    def test_type_found_some_details_missing(self):
        text = "Curativo especial com exsudato seroso, sem necrose."
        assert check_dressing(text) == "não conforme (Curativo especial; faltou: tamanho)"

    def test_type_can_come_before_the_word_dressing(self):
        assert check_dressing("simples curativo, tamanho 2cm, exsudato ausente, sem necrose") == "conforme (Curativo simples)"

    def test_grau_ii_in_both_notations(self):
        assert check_dressing("curativo grau II, tamanho 5cm, exsudato, necrose").startswith("conforme (Curativo grau II")
        assert check_dressing("curativo grau 2, tamanho 5cm, exsudato, necrose").startswith("conforme (Curativo grau II")

    def test_dressing_without_type_goes_to_ai_fallback(self):
        assert check_dressing("curativo oclusivo seco, sem sinais flogísticos") == "Não registrado"

    def test_type_word_alone_is_not_a_dressing(self):
        assert check_dressing("dor controlada com analgésico simples") == "Não se aplica"

    def test_type_word_far_from_dressing_does_not_classify(self):
        assert check_dressing("curativo seco. analgesia simples conforme prescrição.") == "Não registrado"

    def test_not_applicable(self):
        assert check_dressing("Ferida operatória limpa e seca.") == "Não se aplica"

    def test_empty_text(self):
        assert check_dressing("") == "Não se aplica"
