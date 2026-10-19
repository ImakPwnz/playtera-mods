# Skill Prediction – PlayTera (patch 46.05)

A TERA Toolbox module that simulates skills client-side, removing ping-based delays and animation lock.
This build is made **only for PlayTera (client 46.05)**; on any other patch it disables itself.

Skill Prediction does **not** lower your ping. It hides the delay between pressing a skill and the server's answer.

## Installation

1. Close the Toolbox.
2. Create the folder `<Toolbox>\mods\skill-prediction` and put
   [`module.json`](https://raw.githubusercontent.com/ImakPwnz/playtera-mods/main/skill-prediction/module.json) into it.
   The Toolbox downloads the rest on the next start and keeps the module up to date.
   (Alternatively copy this whole folder.)
3. Remove other skill prediction variants (`psp`, `psp31`, `skill-prediction-master`, …) and obsolete mods
   such as `cooldowns`, `lockons`, `fast-fire` – they conflict with this module.
4. Start the Toolbox, then the game.

## Commands

- `/8 sp` – list of commands
- `/8 sp ping` – ping statistics
- `/8 sp debug` – skill debugging (also `debug loc`, `debug abnormal`)

## What was changed for 46.05

Based on [rxkt/psp31](https://github.com/rxkt/psp31) (TERA classic 31.04), which is based on Pinkie Pie's original module.

- Packet versions checked against the PlayTera 46.05 protocol (opcodes + definitions): `S_PLAYER_STAT_UPDATE` 12,
  `S_INVEN` 18 (equipment passivities are read from the new item layout), `C_PLAYER_LOCATION` is detected by size
  (v4 = 41 bytes, v5 = 43 bytes).
- `config/skills.json` (animation lengths, distances, cancel times, chains) and `config/passivity.json` were
  generated from the **PlayTera 46.05 server data** (`UserSkillData_*`, `AnimationData`, `Passivity_*`).
  Where an animation is missing from `AnimationData.xml`, the value from psp31 (or the patch 100 data of
  tera-private-mods) is used.
- When the generated value comes completely from the 46.05 data and has the same shape as a hand-tuned value in
  `config/skills.js`, the 46.05 value is used (per race/gender).
- Skills without usable 46.05 data are **not** predicted – the server stays authoritative for them.
- Config entries that referenced abnormalities which do not exist in 46.05 were removed or disabled
  (Warrior Command: Attack/Follow, fake buffs for Lancer/Slayer/Berserker chains).
- Fixed: Backstab-type skills (`onlyTarget`) crashed on `C_START_SKILL` without a target list;
  passivity type 77 fell through into the stamina handling.

Classes with configuration: Warrior, Lancer, Slayer, Berserker, Sorcerer, Archer, Priest, Mystic, Reaper, Gunner.
Brawler and Ninja have no configuration yet and are not predicted.

## Credits

Pinkie Pie (original), Caali and the TERA Toolbox authors, tera-private-mods, merusira and rxkt (psp31),
PlayTera (46.05 port). License: GPL-3.0 (see `LICENSE`).

---

## Deutsch (Kurzfassung)

Modul für die TERA Toolbox, das Skills clientseitig vorwegnimmt, nur für PlayTera 46.05.
Ordner `<Toolbox>\mods\skill-prediction` anlegen und nur `module.json` hineinlegen – die Toolbox lädt den Rest selbst
und hält das Modul aktuell. Andere Skill-Prediction-Varianten entfernen, Toolbox neu starten.
Die Skilldaten stammen aus den 46.05-Serverdaten; Skills ohne verlässliche Daten werden nicht vorhergesagt.
Werkzeuge zum Neuerzeugen der Daten und der Prüfstand liegen in `_werkzeuge` (werden nicht an Spieler verteilt).
