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
- `/8 sp pvp` – status of the PvP pause (see below); `pvp on|off`, `pvp bg on|off`, `pvp channel 2[,3]|off`,
  `pvp lang en|de|ru`

## PvP pause (battlegrounds and channel 2)

Prediction plays skills before the server confirms them. Against other players this is visible as desync, so the
module pauses itself automatically:

- in every battleground (continents with `channelType="battleField"`, list in `config/battlegrounds.json`),
- in the open world on the PvP channel – **channel 2** as displayed in game (`pvp.channels` in `settings.json`,
  `channelZones` can limit the rule to certain zones).

While paused every skill is handled by the server only, exactly as without the module; the pause ends on the
next zone load / channel change. A chat notice (English, German or Russian – `pvp.language`) tells you when it
pauses and resumes; `pvp notify` can be switched off in `settings.json`. `/8 sp pvp off` disables the pause
completely if you prefer prediction in PvP.

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
- 1.2.0: Brawler and Ninja configuration; abnormality chains (opt-in), `change` redirectors, release of
  redirected hold skills, `serverOnlyWithAbnormal` (see above). Behaviour of the other classes is unchanged
  (checked with the test bench against the previous version).

Classes with configuration: Warrior, Lancer, Slayer, Berserker, Sorcerer, Archer, Priest, Mystic, Reaper, Gunner,
Brawler, Ninja.

## Brawler and Ninja (new in 1.2.0)

Both classes are configured straight from the 46.05 server data (`config/skills.js`, sections 10 and 11). The
module learned three 46.05 mechanics for them (`lib/core.js`):

- **Buff-dependent variants** (`useAbnormalChains`): the server picks a skill variant by an active abnormality –
  Growing Fury stacks for the Brawler (10153001-10153004), chi for the Ninja (10154000-10154006). The module tracks
  those buffs and predicts the same variant.
- **Redirector skills** (`changeDefault`): many Brawler skills start with an id that has no animation of its own
  (type `change`) and leads to `-01` without and `-02` with Growing Fury. The config names the base variant.
- **Press-and-hold skills that got redirected** (Brawler Counter 20100 → 20110/20111): the hold now ends correctly
  when the button is released with the base id. This also fixes chained blocks of other classes.

Left to the server on purpose (no prediction, no desync risk): Counter after a perfect block (buff 10153060, the
counterattack is resolved by the server), the Brawler's 30 s channel, steerable charge (bulldozer), dash + run and
grab (catchback); the Ninja's dashes/teleports (groups 4 and 6) and grab-like 70100; Retaliate for both.

**Not yet verified in game** – please report in Discord if a skill misbehaves: rage/chi costs are not modelled (a
skill the server rejects ends after the server timeout, like a skill on cooldown), and the Punch-after-another-skill
variant (10130) is assumed not to chain any further. `/8 sp debug` shows what the module predicted and what the
server answered.

## Credits

Pinkie Pie (original), Caali and the TERA Toolbox authors, tera-private-mods, merusira and rxkt (psp31),
PlayTera (46.05 port). License: GPL-3.0 (see `LICENSE`).

---

## Deutsch (Kurzfassung)

Modul für die TERA Toolbox, das Skills clientseitig vorwegnimmt, nur für PlayTera 46.05.
Ordner `<Toolbox>\mods\skill-prediction` anlegen und nur `module.json` hineinlegen – die Toolbox lädt den Rest selbst
und hält das Modul aktuell. Andere Skill-Prediction-Varianten entfernen, Toolbox neu starten.
Die Skilldaten stammen aus den 46.05-Serverdaten; Skills ohne verlässliche Daten werden nicht vorhergesagt.
**Brawler und Ninja** (ab 1.2.0): Konfiguration aus den 46.05-Daten, Varianten nach Growing-Fury- bzw. Chi-Buffs
werden mit vorhergesagt. Bewusst beim Server belassen: Counter nach perfektem Block, der 30-s-Kanal, Sturmangriff,
Dash und Griff des Brawlers, die Dashes des Ninja, Retaliate. Noch nicht im Spiel abgenommen – bitte Auffälligkeiten
im Discord melden (`/8 sp debug` zeigt Vorhersage und Serverantwort).
**PvP-Pause:** In Schlachtfeldern und in der offenen Welt auf Channel 2 (PvP) schaltet sich die Vorhersage von
selbst ab, weil sie dort Desync verursacht; eine Chatmeldung (Sprache per `/8 sp pvp lang de`) zeigt das an.
`/8 sp pvp` zeigt den Zustand, `/8 sp pvp off` schaltet die Pause ganz ab.
Werkzeuge zum Neuerzeugen der Daten und der Prüfstand liegen in `_werkzeuge` (werden nicht an Spieler verteilt).
