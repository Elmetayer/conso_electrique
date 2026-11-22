# optiwatt (Python)

CLI et bibliothèque pour récupérer la courbe de charge Linky via [conso.boris.sh](https://conso.boris.sh)
et produire un CSV importable dans l'application web OptiWatt.

```bash
pip install -e ".[dev]"
export CONSO_TOKEN="xxx.yyy.zzz"
optiwatt fetch --prm 12345678901234 --start 2026-10-01 --end 2026-11-01 -o octobre.csv
optiwatt summary octobre.csv
pytest
```
