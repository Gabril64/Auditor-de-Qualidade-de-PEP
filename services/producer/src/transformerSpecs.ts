export type ItemSpec = readonly [label: string, key: string];

export const IDENTIFICATION_ITEMS: ItemSpec[] = [
  ["Prontuário", "prontuario"],
  ["Data de Nascimento", "data_nascimento"],
  ["Idade", "idade"],
  ["Especialidade Internação", "especialidade_internacao"],
  ["Período de Internação", "periodo_internacao"],
  ["Diagnóstico de Internação", "diagnostico_internacao"],
  ["Especialidade Cirurgia", "especialidade_cirurgia"],
  ["Unidade Funcional", "unidade_funcional"],
];

export const MEDICAL_ANAMNESIS_ITEMS: ItemSpec[] = [
  ["HDA", "hda"],
  ["HD / CID", "hd_cid"],
  ["AP / APP", "ap_app"],
  ["AF", "af"],
  ["Exame Físico", "exame_fisico"],
  ["Conduta", "cd"],
  ["Criação Anamnese", "criacao_anamnese"],
];

export const MEDICAL_EVOLUTION_ITEMS: ItemSpec[] = [
  ["HD / CID", "hd_cid"],
  ["Exame Físico", "exame_fisico"],
  ["Procedimentos / Condutas / Queixas", "procedimentos_condutas_queixas"],
  ["Frequência Diária", "frequencia_diaria"],
];

export const SURGERY_ITEMS: ItemSpec[] = [
  ["Especialidade", "especialidade"],
  ["Unidade Funcional", "unidade_funcional"],
  ["Início Cirurgia", "inicio"],
  ["Fim Cirurgia", "fim"],
  ["Diagnóstico / CID", "diagnostico_cid"],
  ["Descrição Procedimento", "descricao_procedimento"],
  ["Descrição Técnica", "descricao_tecnica"],
  ["Uso OPME", "uso_opme"],
];

export const NURSING_ANAMNESIS_ITEMS: ItemSpec[] = [
  ["Motivo Internação", "motivo_internacao"],
  ["AP / APP", "ap_app"],
  ["AF", "af"],
  ["Exame Físico", "exame_fisico"],
  ["Escala Braden", "escala_braden"],
  ["Escala Morse", "escala_morse"],
  ["Conduta", "cd"],
  ["Criação Anamnese", "criacao_anamnese"],
  ["Curativo", "curativo"],
];

export const NURSING_EVOLUTION_ITEMS: ItemSpec[] = [
  ["Motivo Internação", "motivo_internacao"],
  ["Exame Físico", "exame_fisico"],
  ["Condutas", "condutas"],
  ["Escala Braden", "escala_braden"],
  ["Escala Morse", "escala_morse"],
  ["Criação Evolução", "criacao_evolucao"],
  ["Curativo", "curativo"],
];

export const TEAM_ITEMS: ItemSpec[] = [
  ["Categoria", "categoria"],
  ["Descrição", "descricao"],
];

/** Per document type: the label, its key in the document matrix and the conformity count it is scored by. */
export const DOCUMENT_ROWS: ReadonlyArray<
  readonly [label: string, matrixKey: string, countsKey: DocumentCountsKey]
> = [
  ["Anamnese Médica", "MEDICINA - Anamnese", "conformity_b_anamnese"],
  ["Anamnese Enfermagem", "ENFERMAGEM - Anamnese", "conformity_d_anamnese"],
  ["Evolução Médica", "MEDICINA - Evolução", "conformity_b_evolucao"],
  ["Evolução Enfermagem", "ENFERMAGEM - Evolução", "conformity_d_evolucao"],
  ["Serviço Social", "SERVIÇO SOCIAL - Evolução", "conformity_e"],
];

export type DocumentCountsKey =
  | "conformity_b_anamnese"
  | "conformity_d_anamnese"
  | "conformity_b_evolucao"
  | "conformity_d_evolucao"
  | "conformity_e";
