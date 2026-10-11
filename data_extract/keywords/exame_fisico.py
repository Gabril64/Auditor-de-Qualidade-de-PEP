"""Keywords per physical exam system. The exam is only "conforme" if at least ONE word from EACH
system in the category is present. The search is whole-word and accent-insensitive (see
utils/text_match.py). "geral:" only counts as a section label, so it doesn't match "anestesia
geral".
"""
MEDICAL_PHYSICAL_EXAM_TERMS = {
    "Geral": ["estado geral", "geral:", "beg", "reg", "meg", "ebg", "egb"],
    "Cardiovascular": ["acv", "cardiovascular", "bulhas", "ritmo cardíaco", "rcr", "bnf", "ausculta cardíaca", "sopro", "sopros"],
    "Respiratório": ["ar", "aparelho respiratório", "respiratório", "murmúrio vesicular", "mv", "ausculta pulmonar", "ausculta respiratória", "ruídos adventícios", "crepitações"],
    "Abdome": ["abd", "abdome", "abdômen", "rha", "ruídos hidroaéreos", "visceromegalias"],
    "Extremidades": ["ext", "extremidades", "mmii", "mmss", "membros inferiores", "membros superiores", "pulsos", "perfusão", "panturrilhas", "edema"],
}

NURSING_PHYSICAL_EXAM_TERMS = {
    "Nervoso": ["sistema nervoso", "snc", "neurológico", "consciente", "lúcido", "lúcida", "orientado", "orientada", "glasgow", "pupilas"],
    "Pele/Mucosas": ["pele", "mucosas", "corado", "corada", "hidratado", "hidratada", "turgor", "elasticidade", "tegumento"],
    "Respiratório": ["respiratório", "eupneico", "eupneica", "dispneico", "dispneica", "taquipneico", "taquipneica", "murmúrio vesicular", "mv", "saturação", "sato2", "spo2", "o2", "cateter nasal"],
    "Cardiovascular": ["cardiovascular", "acv", "ritmo cardíaco", "bulhas", "pulsos", "perfusão", "fc", "pa", "acesso venoso"],
    "Gastrointestinal": ["gastrointestinal", "abdome", "abdômen", "rha", "ruídos hidroaéreos", "dieta", "evacuação", "eliminação intestinal"],
    "Genitourinário": ["genitourinário", "geniturinário", "diurese", "sonda vesical", "eliminação vesical"],
    "Músculo-esquelético": ["músculo-esquelético", "musculoesquelético", "mobilidade", "deambula", "deambulando", "deambulação", "força motora", "restrito ao leito", "mudança de decúbito"],
    "Escalas": ["braden", "morse"],
}
