/** Maps each key of a submitted patient record to its column in `raw_record_entries`. Keys keep
 * their original spelling (including the source typo `criacao_anamnsese`); `original_json`
 * preserves the untouched entry. */
export const RAW_RECORD_COLUMNS: ReadonlyArray<readonly [key: string, column: string]> = [
  ["Atendimento", "encounter"],
  ["Categoria Profissional", "professional_category"],
  ["Cid procedimento", "procedure_icd_code"],
  ["Código Sus pact", "patient_sus_code"],
  ["Data De Nascimento pact", "patient_birth_date"],
  ["Data Fim Cirurgia", "surgery_end_at"],
  ["Data Inicio Cirurgia", "surgery_start_at"],
  ["Data da internação", "admission_at"],
  ["Data de saída", "discharge_at"],
  ["Data de óbito", "death_at"],
  ["Descricao do registro", "entry_description"],
  ["Descrição Cirurgica", "surgical_description"],
  ["Especialidade cirurgia", "surgery_specialty"],
  ["Procedimento Interno Realizado", "internal_procedure_performed"],
  ["Procedimento cirurgico Realizado", "surgical_procedure_performed"],
  ["Prontuário", "record_number"],
  ["Seguiu protoc Cirurgia Segura?", "followed_safe_surgery_protocol"],
  ["Sexo", "sex"],
  ["Tipo do registro", "entry_type"],
  ["UF cirurgia", "surgery_functional_unit"],
  ["Unidade Funcional Internaçao", "admission_functional_unit"],
  ["Usou Antibiótico Profilático?", "used_prophylactic_antibiotic"],
  ["Utilizou O2?", "used_oxygen"],
  ["criacao_anamnsese", "anamnesis_created_at"],
];
