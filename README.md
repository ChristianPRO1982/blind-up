# BlindUp

[![Release](https://img.shields.io/github/v/release/ChristianPRO1982/blind-up?display_name=tag)](https://github.com/ChristianPRO1982/blind-up/releases)
![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?logo=sqlite&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-F7DF1E?logo=javascript&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![pytest](https://img.shields.io/badge/pytest-tested-0A9EDC?logo=pytest&logoColor=white)
![Ruff](https://img.shields.io/badge/Ruff-linted-D7FF64?logo=ruff&logoColor=black)

**EN 🇬🇧 Turn your local music library into a loud, fast, addictive party blind test built for one host and a full room of players.**

**New: BlindUp mode mixes classic Blind Test with a Time's Up-style progression across 3 rounds with different rules (classic, reverse, escalation).**

---

**FR 🇫🇷 Transforme ta bibliothèque audio locale en blind test de soirée, nerveux, festif et prêt à mettre toute la salle en jeu autour d'un seul animateur.**

**Nouveauté : le mode BlindUp fusionne Blind Test et Time's Up en 3 manches aux règles différentes (classique, reverse, escalation).**

---

## Lancer BlindUp en local

### 1. Modifier `docker-compose.yml`

Dans [docker-compose.yml](/home/christianpro1982/Documents/cARThographie/blind-up/docker-compose.yml), configure :

* le chemin hôte de ta bibliothèque audio dans le volume monté sur `/music-library`
* le chemin hôte utilisé pour stocker les covers extraites dans le volume monté sur `/covers`

Exemple actuel :

```yml
environment:
  BLINDUP_DB_PATH: /data/blindup.db
  BLINDUP_LIBRARY_ROOT_PATH: /music-library
  BLINDUP_COVERS_DIR: /covers

volumes:
  - blindup-data:/data
  - /chemin/vers/tes/fichiers-audio:/music-library:ro
  - /chemin/vers/ton/dossier-covers:/covers
```

Le montage `/covers` doit rester **inscriptible**. Ne pas ajouter `:ro`, sinon BlindUp ne pourra pas sauvegarder les images extraites.

### 2. Lancer Docker

Depuis la racine du projet :

```bash
docker compose up --build
```

### 3. Ouvrir l'application

BlindUp sera accessible sur :

```text
http://127.0.0.1:8500/
```
