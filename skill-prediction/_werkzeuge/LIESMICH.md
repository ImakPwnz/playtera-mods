# Werkzeuge (nur für Betreiber/Entwickler)

Der Ordner beginnt mit `_` und steht deshalb nicht im `manifest.json`. Spieler bekommen ihn nicht.

## Skilldaten neu erzeugen

Nötig, wenn Skilldaten auf dem Server geändert wurden (z. B. `timeRate`, Abbruchzeiten oder Animationen).

```
python -I _werkzeuge/gen46.py <Datasheet-Ordner> _neu --fallback config/skills.json
```

- Schreibt `_neu/skills.json`, `_neu/passivity.json` und `_neu/ohne_vorhersage.json`.
- `--fallback`: frühere Daten für Skills, deren Animation in `AnimationData.xml` fehlt. Die vorhandene
  `config/skills.json` enthält diese Werte bereits. Ursprünglich: psp31 (`config/skills.json`) und tera-private-mods
  (`client_data/skills.json`, Patch 100).
- Formeln (gegen Patch-100-Daten geeicht, 98 % Übereinstimmung bei unveränderten Skills):
  - `pendingStartTime`, `rearCancelStartTime`, `frontCancelEndTime` = Zeit / `timeRate` (abgerundet)
  - `length` (einstufig) = min(`moveCancelStartTime`, Animationsdauer − 100 × `timeRate`) / `timeRate`
  - `length` (Aufladen) = Ladestufen ohne die letzte, ohne `timeRate` (das rechnet der Kern selbst)
  - `distance` = Summe `moveDistance` × `rootMotionXYRate` der Root-Motion-Animationen
  - `x: 1` = Wert stammt vollständig aus 46.05-Daten (hat dann Vorrang vor festen Werten in `config/skills.js`)

Danach Dateien nach `config/` kopieren, prüfen und Manifest neu erzeugen.

## Prüfen

```
node _werkzeuge/checkcfg.js config/skills.js config/skills.json <Datasheet-Ordner>
node _werkzeuge/pruefstand.js <Toolbox-Ordner> .
node _werkzeuge/manifest.js
```

- `checkcfg.js`: konfigurierte Skills, die es in 46.05 nicht gibt; Verweise auf fehlende Abnormalities; feste Werte,
  die von 46.05 abweichen.
- `pruefstand.js`: lädt das Modul mit der echten `Dispatch`-Klasse der Toolbox und dem 46.05-Protokoll, prüft jeden
  Hook und jedes gesendete Paket und spielt jeden konfigurierten Skill aller Vorlagen mit virtueller Uhr durch
  (Vorhersage, Serverbestätigung nach 30 ms, Ende, Zeitpunkt). Ersetzt **keine** Spielabnahme.
- Umgebungsvariablen für den Prüfstand: `SP_TPL=10101` (nur eine Vorlage), `SP_DEBUG=1` (Debug-Ausgabe des Moduls).
- Der Prüfstand enthält außerdem feste Fälle für die 46.05-Mechaniken (Umleiter, Buff-Ketten, Loslassen von
  Haltetasten, Rückwirkung auf Berserker/Gunner) und die PvP-Sperre; Ergebnis unter `mechaniken4605` / `pvpSperre`.
- Ohne PlayTera-Toolbox: Die öffentliche tera-toolbox (GitHub) reicht für die Ablaufprüfung. Dazu in
  `<Toolbox>/data/data.json` die fehlenden 46.05-Definitionen (`S_LOGIN.12`, `S_INVEN.18`, `S_PLAYER_STAT_UPDATE.12`,
  `S_EACH_SKILL_RESULT.13`, `S_ABNORMALITY_BEGIN.3`, `C_START_TARGETED_SKILL.6`, `C_START_INSTANCE_SKILL.5`,
  `C_START_COMBO_INSTANT_SKILL.4`, `S_PARTY_MEMBER_LIST.7`, `S_CURRENT_CHANNEL.1`, `C_PLAYER_LOCATION.4`) aus der
  tera-data-Historie als `protocol`-Einträge ergänzen. Fehlt die Opcode-Tabelle `302664`, vergibt der Prüfstand
  Ersatz-Opcodes (Ausgabe `opcodes: ERSATZ`) – dann werden nur Ablauf und Definitionen geprüft, nicht die echten Opcodes.

## Konfigurationsschlüssel für 46.05 (config/skills.js)

Zusätzlich zu den bekannten Schlüsseln des Originals (`noInterrupt`, `fixedSpeed`, `stamina`, `categoryChains`, …):

- `useAbnormalChains: true` – die `abnormalChains` aus `skills.json` (AddAbnormalityConnectSkill) werden ausgewertet:
  ist einer der Buffs aktiv, wird auf die genannte Variante umgeleitet (Vorrang vor den Kategorie-Ketten, wie im
  Original). Für die klassischen Klassen bleibt es aus, deren Konfiguration bildet die Buffs anders nach.
- `changeDefault: <Unter-ID>` – Ziel eines `change`-Skills (reiner Umleiter ohne eigene Animation), wenn kein Buff und
  keine Kette greift; ohne diesen Schlüssel bleibt der Skill beim Server. `change`-Skills mit eigener Animation
  (z. B. Berserker 120100) brauchen ihn nicht.
- `serverOnlyWithAbnormal: [ids]` – solange einer der Buffs aktiv ist, geht der Skill unverändert an den Server
  (Brawler Counter nach perfektem Block, 10153060); dessen `S_CANNOT_START_SKILL` wird dann durchgereicht.
- `categoryChains: {}` – schaltet die Kettenregeln der Daten für genau diesen Skill ab (Brawler 10130/10131/40130:
  deren Regeln zeigen auf nicht existierende Skills und würden sonst weiter kaskadieren).
