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

---

**FR 🇫🇷 Transforme ta bibliothèque audio locale en blind test de soirée, nerveux, festif et prêt à mettre toute la salle en jeu autour d'un seul animateur.**

---

## Lancer BlindUp en local

### 1. Modifier `docker-compose.yml`

Dans [docker-compose.yml](/home/christianpro1982/Documents/cARThographie/blind-up/docker-compose.yml), remplace le chemin hôte de ta bibliothèque audio par le tien dans le volume monté sur `/music-library`.

Exemple actuel :

```yml
volumes:
  - blindup-data:/data
  - /home/christianpro1982/Musique/blind-up:/music-library:ro
```

Exemple à adapter :

```yml
volumes:
  - blindup-data:/data
  - /chemin/vers/tes/fichiers-audio:/music-library:ro
```

Seule la partie avant `:/music-library:ro` doit être changée.

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
