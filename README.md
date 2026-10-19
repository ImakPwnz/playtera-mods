# PlayTera Mods

TERA Toolbox modules for **PlayTera** (client 46.05). Every module lives in its own folder and updates itself
through the Toolbox from this repository.

| Module | Description |
|---|---|
| [skill-prediction](skill-prediction/) | Simulates skills client-side, removes ping-based delays and animation lock. |

## Installing a module

1. Close the Toolbox.
2. Create `<Toolbox>\mods\<module name>` and put the module's `module.json` into it
   (e.g. [skill-prediction/module.json](https://raw.githubusercontent.com/ImakPwnz/playtera-mods/main/skill-prediction/module.json)).
3. Start the Toolbox – it downloads the remaining files and keeps the module up to date.

`modulelist.json` lists all modules in the format of the Toolbox "Get More Mods" list.

## Adding a new module (maintainers)

1. New folder `<module name>/` with `module.json`; `servers` must point to
   `https://raw.githubusercontent.com/ImakPwnz/playtera-mods/main/<module name>/`.
2. Generate `manifest.json` (SHA-256 per file; files/folders starting with `.` or `_` and `settings.json` are not
   distributed), e.g. with `node skill-prediction/_werkzeuge/manifest.js <module folder>`.
3. Add the module to `modulelist.json` and to the table above.
4. Only packets that exist in the 46.05 protocol may be hooked – a missing definition stops the whole module.

Support: https://playtera.to

---

**Deutsch:** Sammlung von Toolbox-Modulen für PlayTera (46.05). Jedes Modul hat einen eigenen Ordner und aktualisiert
sich über die Toolbox aus diesem Repository. Installation: Ordner `<Toolbox>\mods\<Modulname>` anlegen, die
`module.json` des Moduls hineinlegen, Toolbox starten.
