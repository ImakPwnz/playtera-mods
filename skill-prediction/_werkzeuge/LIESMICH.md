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
