# VibeMTA kliens

A VibeMTA szerver saját kliense: a [Multi Theft Auto: San Andreas](https://github.com/multitheftauto/mtasa-blue)
fő (`master`, 1.7) ágának módosított változata, GPLv3 licenc alatt (lásd `LICENSE`).

A módosítások a `VIBEMTA` makró alatt vannak (`Shared/sdk/vibemta.h`):
- indításkor egyből a VibeMTA szerverre csatlakozik, nincs MTA főmenü / szerverböngésző
- a szerverről kilépve (vagy kapcsolat bontásakor) a játék bezárul
- saját registry ág és ProgramData mappa (a gépen lévő hivatalos MTA-t nem zavarja)
- az MTA hivatalos frissítője és hírei kikapcsolva
- VibeMTA arculat (betöltőkép, menü háttér, ikon, ablakcím)

A fordítás a GitHub Actions-ben fut (`.github/workflows/vibemta.yaml`), az eredmény a Releases alatt érhető el.
Multi Theft Auto is not affiliated with Rockstar Games or Take-Two Interactive.
