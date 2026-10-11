import json
import sys

from data_extract.core.auditor import audit_medical_records


def run_audit(records: list) -> list:
    """
    Main entry point for auditing medical records in memory.
    Expects a list of dictionaries (the parsed JSON records)
    and returns a structured list of audit results.
    """
    if not records:
        return []

    sys.stderr.write(f"Auditing {len(records)} records...\n")

    return audit_medical_records(records)


def _run_cli() -> None:
    """Reads records as JSON from stdin and prints the audit result as JSON to stdout.
    stdin/stdout keep large payloads from the JS caller out of argv."""
    try:
        input_data = sys.stdin.read()
        if not input_data.strip():
            sys.stderr.write("Erro: Nenhum dado JSON fornecido na entrada padrão (stdin).\n")
            sys.exit(1)

        records = json.loads(input_data)
        results = run_audit(records)
        print(json.dumps(results, ensure_ascii=False))

    except json.JSONDecodeError as e:
        sys.stderr.write(f"Erro ao decodificar JSON: {str(e)}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Erro interno: {str(e)}\n")
        sys.exit(1)


if __name__ == "__main__":
    _run_cli()
