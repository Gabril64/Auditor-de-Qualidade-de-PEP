"""Talks to the LMStudio endpoint to fill in fields the keyword rules left as "Não registrado".

AI_TEMPERATURE/AI_TOP_K/AI_TOP_P pin the decoding so two runs of the same record produce the same
audit. The defaults (0, 1, 1) are greedy decoding: the most likely token is always taken, which
removes sampling from the result. AI_SEED (notebook -> Producer -> Worker -> env LLM_SEED) is sent
alongside it and recorded in the audit's signature, so the run is documented as well as repeatable.
This is why LMSTUDIO_URL points at the OpenAI-compatible route: LMStudio's own /api/v1/chat answers
400 "Unrecognized key(s) in object: 'seed'" and cannot carry a seed at all.
AI_MAX_CONTEXT_CHARS caps a record's text sent to the AI so small models' context does not
overflow. AI_OK/AI_TIMEOUT/AI_HTTP_ERROR/AI_INVALID_JSON/AI_EMPTY_RESPONSE/AI_MISSING_FIELDS are
the possible outcomes of one AI call; query_ai_fields()'s docstring lists them with "status".
"""
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request

from data_extract.utils.text_match import normalize

LMSTUDIO_URL = os.environ.get("LMSTUDIO_URL", "http://localhost:1234/v1/chat/completions")
MODEL_NAME = os.environ.get("LLM_MODEL", "qwen2.5-3b-instruct")
_seed_env = os.environ.get("LLM_SEED", "").strip()
AI_SEED = int(_seed_env) if _seed_env.lstrip("-").isdigit() else None
AI_TEMPERATURE = float(os.environ.get("AI_TEMPERATURE", "0"))
AI_TOP_K = int(os.environ.get("AI_TOP_K", "1"))
AI_TOP_P = float(os.environ.get("AI_TOP_P", "1"))
AI_MAX_CONTEXT_CHARS = int(os.environ.get("AI_MAX_CONTEXT_CHARS", "6000"))
AI_MAX_ATTEMPTS = int(os.environ.get("AI_MAX_ATTEMPTS", "3"))
AI_TIMEOUT_SECONDS = int(os.environ.get("AI_TIMEOUT_SECONDS", "300"))
AI_RETRY_DELAY_SECONDS = float(os.environ.get("AI_RETRY_DELAY_SECONDS", "1"))

AI_OK = "ok"
AI_TIMEOUT = "timeout"
AI_HTTP_ERROR = "http_error"
AI_INVALID_JSON = "invalid_json"
AI_EMPTY_RESPONSE = "empty_response"
AI_MISSING_FIELDS = "campos_ausentes"

# Repeating a call only helps when the environment hiccuped. A format failure — missing keys,
# invalid JSON, empty answer — is deterministic under greedy decoding: the same payload gives the
# same answer, so retrying it burns time and still fails. It is a property of the model, not luck.
RETRYABLE = {AI_TIMEOUT, AI_HTTP_ERROR}

FIELD_RULES = {
    "curativo": "Curativo (ITEM NÃO OBRIGATÓRIO — só avalie se houver menção explícita a curativo). Classifique o TIPO em uma de 3 categorias: 'simples' (feridas simples), 'especial' (feridas complexas, coberturas especiais, drenos) ou 'grau II' (lesões abertas extensas, com exposição de tecido). O curativo só está CONFORME se o TIPO foi identificado E o texto descreve TAMANHO, EXSUDATO e NECROSE. Respostas: se tudo estiver presente, retorne 'Curativo <tipo>'. Se o tipo foi identificado mas falta algo, retorne 'não conforme: Curativo <tipo>; faltou: <itens que faltam>'. Se há menção a curativo mas NÃO é possível identificar o tipo, retorne 'não conforme: tipo de curativo não identificado'. Se não houver NENHUMA menção a curativo, retorne null.",
    "hda": "História da Doença Atual (HDA). Procure relatos sobre como o sintoma ou doença que motivou a internação começou e evoluiu ao longo do tempo (ex: 'paciente iniciou quadro há 3 dias com...'). Geralmente é uma narrativa temporal, não apenas uma palavra ou diagnóstico isolado. Diferente de 'motivo_internacao', que é a razão objetiva e direta da internação.",
    "hd_cid": "Hipótese Diagnóstica (HD) ou CID, como está registrado no documento — extraia o trecho LITERAL que aparece após as marcas '#HD:', 'HD:', 'Hipótese Diagnóstica:' ou 'CID:'. Este campo é sobre COMO o diagnóstico está formalmente registrado no documento, não uma interpretação sua do diagnóstico.",
    "diagnostico_cid": "Diagnóstico clínico principal (a doença em si, não o registro formal). Procure ESPECIFICAMENTE após as marcas '#HD:', 'HD:' ou 'Hipótese Diagnóstica'. Exemplos válidos: 'Hérnia Incisional pós-herniorrafia', 'Pneumonia Bacteriana', 'Apendicite Aguda'. NÃO use o nome de um procedimento cirúrgico como resposta (ex: 'Sinusotomia' NÃO é diagnóstico, é o procedimento realizado — use o campo 'descricao_procedimento' para isso). Se 'hd_cid' e 'diagnostico_cid' apontarem para o mesmo trecho de texto, isso é esperado — retorne o mesmo valor nos dois campos.",
    "diagnostico_internacao": "Diagnóstico principal que justificou a internação (mesmo conceito clínico de 'diagnostico_cid', mas focado no motivo de internação). Procure por hipóteses diagnósticas (#HD:), CID, ou descrição da doença/motivo que levou à internação. Exemplos: 'Hérnia Incisional', 'Insuficiência Cardíaca', 'Fratura de Fêmur'. Se coincidir com 'diagnostico_cid', retorne o mesmo valor — não é erro os dois campos serem iguais.",
    "descricao_procedimento": "Descrição do procedimento ou intervenção cirúrgica REALIZADA (o que efetivamente foi feito na cirurgia). Geralmente encontrado em seções tipo 'PROCEDIMENTOS REALIZADOS' ou na descrição cirúrgica. Diferente de 'diagnostico_cid' (a doença) e de 'cd'/'condutas' (plano futuro de ação).",
    "descricao_tecnica": "Descrição da técnica cirúrgica, achados intraoperatórios ou passo a passo numerado da cirurgia (ex: '1. Paciente em decúbito dorsal...', '2. Assepsia...'). Geralmente é um texto longo e sequencial, diferente de 'descricao_procedimento', que é mais um resumo/nome do procedimento.",
    "uso_opme": "Uso de Órteses, Próteses ou Materiais Especiais (OPME) — ITEM NÃO OBRIGATÓRIO. Procure menções a materiais implantados ou utilizados (ex: tela, placa, parafuso, tala, cateter, malha, prótese, haste, cimento). Se houver menção e o material estiver descrito de forma específica (qual material), retorne o trecho. Se houver menção mas mal descrita (ex: apenas 'material de síntese', sem dizer qual), retorne 'não conforme: <o que falta descrever>'. Se não houver nenhuma menção, retorne null — não infira uso de OPME apenas porque houve cirurgia.",
    "ap_app": "Antecedentes Pessoais (Patológicos) DO PRÓPRIO PACIENTE — não da família. Procure doenças pré-existentes, cirurgias anteriores, histórico médico, comorbidades (ex: HAS, DM, DLP) ou alergias DO PACIENTE. Termos comuns: COMORBIDADES, ALERGIAS, APP, Antecedentes Pessoais. IMPORTANTE — negação seguida de afirmação: se o texto tiver uma negação geral (ex: 'NEGA HAS/DM') seguida de uma afirmação específica (ex: 'REFERE ALERGIA A DIPIRONA'), a afirmação específica PREVALECE e deve ser extraída, mesmo com a negação anterior. Exemplo: texto 'PACIENTE NEGA HAS / DM. REFERE ALERGIA A DIPIRONA.' -> retornar 'REFERE ALERGIA A DIPIRONA'. Se o texto APENAS negar, sem nenhuma afirmação positiva depois (ex: só 'NEGA COMORBIDADES'), retorne null — negação pura não conta como informação presente. NÃO confunda com antecedentes familiares (campo 'af') — só preencha aqui se for sobre o próprio paciente, não sobre parentes.",
    "af": "Antecedentes Familiares — histórico de doenças em PARENTES do paciente (mãe, pai, irmãos, avós), e NÃO do próprio paciente. Só preencha se houver menção EXPLÍCITA a um familiar (ex: 'mãe hipertensa', 'pai diabético', 'histórico familiar de câncer'). Se o texto disser apenas 'paciente nega HAS/DM' (sem citar família), isso NÃO é antecedente familiar — retorne null, mesmo que HAS/DM sejam mencionados.",
    "exame_fisico": "Exame Físico. Procure avaliações clínicas corporais objetivas: ausculta, palpação, inspeção, sinais vitais, estado geral, sistemas (nervoso, respiratório, cardiovascular, etc.). Geralmente é uma seção estruturada com múltiplos subitens.",
    "cd": "Conduta médica (plano de ação definido pelo MÉDICO). Procure pelo plano terapêutico, geralmente após as marcas 'CD:', 'Conduta:' ou 'Plano:'. Inclui prescrições, exames solicitados, encaminhamentos. Exemplo: 'CD: Solicito TC de abdome, manter dieta zero' -> retornar 'Solicito TC de abdome, manter dieta zero'. Diferente de 'condutas' (que é a versão de ENFERMAGEM, não médica) e de 'procedimentos_condutas_queixas' (que também inclui queixas do paciente, não só o plano). NÃO confundir com motivo da internação nem diagnóstico.",
    "procedimentos_condutas_queixas": "Procedimentos, condutas OU queixas relatadas pelo paciente — campo mais amplo que 'cd', usado quando o registro mistura ações tomadas com reclamações/sintomas relatados pelo paciente. Use este campo apenas quando o texto não permitir separar claramente conduta de queixa.",
    "motivo_internacao": "Motivo objetivo da internação — resposta direta a 'por que o paciente está internado'. Geralmente uma frase curta (ex: 'internação para realização de sinusectomia bilateral'). Diferente de 'hda', que é a narrativa de como o quadro evoluiu, não apenas o motivo direto.",
    "escala_braden": "Escala de Braden — avaliação de risco de lesão por pressão (úlceras). Procure o valor numérico e/ou classificação de risco (ex: 'BRADEN 18 RISCO LEVE'). Retorne o trecho com valor e classificação, se ambos existirem.",
    "escala_morse": "Escala de Morse — avaliação de risco de quedas. Procure o valor numérico e/ou classificação de risco (ex: 'MORSE 15 RISCO BAIXO'). Retorne o trecho com valor e classificação, se ambos existirem.",
    "condutas": "Condutas de ENFERMAGEM (não médicas) realizadas ou planejadas. Geralmente aparece em seção 'CONDUTAS:' dentro de registros de Enfermagem. Diferente de 'cd', que é a conduta do MÉDICO.",
}

def _build_prompts(text, missing_fields, record_type):
    definitions = []
    for field in missing_fields:
        description = FIELD_RULES.get(field, f"Encontre se existe informação sobre {field}.")
        definitions.append(f"- {field}: {description}")

    definitions_text = "\n".join(definitions)

    system_prompt = (
        "Você é um auditor médico altamente técnico e preciso. "
        "Sua tarefa é analisar o texto do registro médico abaixo e extrair as informações solicitadas, avaliando também sua completude.\n"
        "Você deve retornar APENAS um objeto JSON válido, onde a chave é o nome do campo e o valor é a string EXATA contendo o trecho do texto onde a informação foi encontrada. "
        "Se a informação não estiver presente no texto, o valor deve ser null.\n"
        "IMPORTANTE: Verifique a completude da informação. Por exemplo, no 'exame_fisico', se a descrição for muito curta ou faltarem os sistemas básicos (respiratório, cardiovascular, etc), você DEVE retornar 'não conforme: <motivo curto explicando o que falta>' em vez da extração. Use sempre o formato 'não conforme: <motivo>' quando a informação existir mas estiver incompleta ou incorreta.\n"
        "NUNCA retorne texto fora do JSON. NUNCA use formatação markdown como ```json.\n\n"
        f"Campos que você deve buscar:\n{definitions_text}"
    )
    input_text = f"TIPO DO REGISTRO: {record_type}\nTEXTO DO REGISTRO:\n{text}"
    return system_prompt, input_text


def _extract_response_text(result_json):
    """Handles LMStudio's common response formats."""
    if "choices" in result_json:
        return result_json["choices"][0]["message"]["content"]
    if "output" in result_json and isinstance(result_json["output"], list) and len(result_json["output"]) > 0:
        return result_json["output"][0].get("content", "")
    for key in ("content", "response", "text"):
        if key in result_json:
            return result_json[key]
    return str(result_json)


def _comparable(name):
    """Comparison form of a field name: no case, no accents, no separators."""
    return re.sub(r"[^a-z0-9]", "", normalize(name))


def _match_requested_keys(parsed, missing_fields):
    """Renames answer keys that are orthographic variants of the requested field names. A model
    answering in Portuguese often "fixes" the spelling of an unaccented key — phi-4-mini-instruct
    answered `"diagnóstico_internacao"` for the requested `diagnostico_internacao`, with the right
    content. The field is the same, so the variant must not be counted as an unanswered field;
    counting it would measure spelling instead of audit quality. An exact answer always wins, and
    a key that matches no requested field is left untouched. Returns {field: key the model used}.
    """
    wanted = {_comparable(field): field for field in missing_fields}
    renamed = {}
    for key in [k for k in parsed if k not in missing_fields]:
        field = wanted.get(_comparable(key))
        if field and field not in parsed:
            parsed[field] = parsed.pop(key)
            renamed[field] = key
    return renamed


def _strip_markdown(text):
    text = (text or "").strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _post(payload):
    req = urllib.request.Request(
        LMSTUDIO_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=AI_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8")


def _single_attempt(payload, missing_fields):
    """One call to LMStudio. Returns (status, fields, error)."""
    try:
        try:
            response_data = _post(payload)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            return AI_HTTP_ERROR, {}, f"HTTP {e.code}: {body[:200]}"
        result_json = json.loads(response_data)
    except (socket.timeout, TimeoutError) as e:
        return AI_TIMEOUT, {}, f"timeout após {AI_TIMEOUT_SECONDS}s: {e}"
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)):
            return AI_TIMEOUT, {}, f"timeout após {AI_TIMEOUT_SECONDS}s: {e}"
        return AI_HTTP_ERROR, {}, str(e)
    except json.JSONDecodeError as e:
        return AI_INVALID_JSON, {}, f"resposta HTTP não é JSON: {e}"
    except Exception as e:
        return AI_HTTP_ERROR, {}, f"{type(e).__name__}: {e}"

    try:
        response_text = _strip_markdown(_extract_response_text(result_json))
    except Exception as e:
        return AI_EMPTY_RESPONSE, {}, f"formato de resposta inesperado: {e}"

    if not response_text:
        return AI_EMPTY_RESPONSE, {}, "resposta vazia"

    sys.stderr.write(f"  [AI Fallback] Resposta: {response_text}\n")

    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError as e:
        return AI_INVALID_JSON, {}, f"{e}; resposta: {response_text[:200]}"

    if not isinstance(parsed, dict):
        return AI_INVALID_JSON, {}, f"JSON não é um objeto: {response_text[:200]}"

    missing = [f for f in missing_fields if f not in parsed]
    if missing:
        return AI_MISSING_FIELDS, parsed, f"chaves ausentes na resposta: {missing}"

    return AI_OK, parsed, None


def _attempt(payload, missing_fields):
    """One attempt with the answer's keys reconciled against the requested field names. A rename
    can turn a "missing keys" outcome into a complete answer, which is the whole point: the content
    was there, only the spelling of the key differed. Returns (status, fields, error, renamed)."""
    status, fields, error = _single_attempt(payload, missing_fields)
    renamed = _match_requested_keys(fields, missing_fields) if isinstance(fields, dict) else {}
    for field, key in renamed.items():
        sys.stderr.write(f"  [AI Fallback] chave '{key}' reconhecida como '{field}' (variante ortográfica).\n")

    if renamed and status == AI_MISSING_FIELDS:
        still_missing = [f for f in missing_fields if f not in fields]
        status, error = (AI_OK, None) if not still_missing else (status, f"chaves ausentes na resposta: {still_missing}")
    return status, fields, error, renamed


def query_ai_fields(text, missing_fields, record_type):
    """
    Queries the LLM up to AI_MAX_ATTEMPTS times and returns a structured outcome:
    {
      "status": ok | timeout | http_error | invalid_json | empty_response | campos_ausentes,
      "fields": {field: snippet|None},  # what the AI returned on the best attempt
      "error": str | None,              # reason for the last failure
      "attempts": int,
      "latency": float,                 # seconds summed across every attempt
      "sampling": dict,                 # the decoding actually sent (seed, temperature, top_k, top_p)
      "renamed_keys": dict,             # {field: key the model used} for orthographic variants
    }
    status is "ok" only when EVERY requested key came back in the JSON
    (a null value is a valid answer: the AI looked and found nothing).
    """
    if not text or not text.strip():
        return {"status": AI_OK, "fields": {}, "error": None, "attempts": 0, "latency": 0.0}

    system_prompt, input_text = _build_prompts(text, missing_fields, record_type)
    # Chat-completions shape: the two prompts become the system and user turns. The decoding goes
    # in every request — without it the server applies its own default temperature, which is what
    # made earlier runs non-reproducible — and the seed travels with it.
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": input_text},
        ],
        "temperature": AI_TEMPERATURE,
        "top_k": AI_TOP_K,
        "top_p": AI_TOP_P,
    }
    if AI_SEED is not None:
        payload["seed"] = AI_SEED

    started_at = time.time()
    status, fields, error = AI_HTTP_ERROR, {}, None
    renamed = {}
    attempts = 0
    for attempts in range(1, AI_MAX_ATTEMPTS + 1):
        sys.stderr.write(f"  [AI Fallback] Chamando LMStudio para os campos: {missing_fields} (tentativa {attempts}/{AI_MAX_ATTEMPTS})...\n")
        status, fields, error, attempt_renamed = _attempt(payload, missing_fields)
        renamed.update(attempt_renamed)
        if status == AI_OK:
            break
        sys.stderr.write(f"  [AI Fallback Error] tentativa {attempts}/{AI_MAX_ATTEMPTS} falhou ({status}): {error}\n")
        if status not in RETRYABLE:
            sys.stderr.write(f"  [AI Fallback] {status} se repetiria igual (decodificação determinística): não insiste.\n")
            break
        if attempts < AI_MAX_ATTEMPTS:
            time.sleep(AI_RETRY_DELAY_SECONDS)

    return {
        "status": status,
        "fields": fields,
        "error": error,
        "attempts": attempts,
        "latency": time.time() - started_at,
        "renamed_keys": renamed,
        "sampling": {
            "seed": AI_SEED,
            "temperature": AI_TEMPERATURE,
            "top_k": AI_TOP_K,
            "top_p": AI_TOP_P,
        },
    }


def validate_missing_fields_with_ai(text, missing_fields, record_type):
    """Compatibility wrapper: returns just the fields dict (empty on failure)."""
    return query_ai_fields(text, missing_fields, record_type)["fields"]
