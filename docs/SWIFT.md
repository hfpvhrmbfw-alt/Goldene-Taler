# Übertragung nach Swift

| Datei | Schicht | In Swift |
|---|---|---|
| `src/model.js` | Modell | 1:1 als `struct`/`enum` (Codable), `sanitize` als `init?(raw:)` |
| `src/logic.js` | Logik | 1:1 als freie Funktionen bzw. `enum Logic` mit `static func` |
| `src/catalog.js` | Katalog | `catalog.json` im Bundle |
| `tests/fixtures/*` | Testfälle | gleiche Dateien in XCTest/Swift Testing |
| `src/storage.js` | Speicher | neu: SwiftData oder Datei im App-Container |
| `src/texts.js` | Texte | neu: String Catalog |
| `src/ui.js`, `src/main.js` | Oberfläche | neu: SwiftUI |

In Swift entfällt der Umweg über die Textdatei: ein App-Intent (`AppIntent` mit Parametern Betrag, Händler,
Karte) kann direkt aus der Transaktions-Automation aufgerufen werden und speichert sofort.
`parseLogLine` bleibt für den Import alter Dateien.

## Typen

```swift
enum CategoryID: String, Codable, CaseIterable {
  case lebensmittel, essen, mobilitaet, shopping, drogerie, haushalt, gesundheit, freizeit, abos, reisen, sonstiges
}
struct Transaction: Codable, Identifiable {
  var id: String; var date: String /* YYYY-MM-DD */; var time: String?
  var amountCents: Int; var currency: String; var merchant: String; var card: String
  var categoryId: CategoryID?; var manualCategory: Bool; var note: String
  var source: Source; enum Source: String, Codable { case shortcut, manual }
}
struct Rule: Codable, Identifiable { var id: String; var pattern: String; var categoryId: CategoryID }
struct Settings: Codable { var monthlyBudgetCents: Int?; var currency: String }
```

## Regeln

- Datum als `YYYY-MM-DD`, so wie im Kurzbefehl geschrieben, ohne Zeitzonen-Umrechnung. "Heute" wird übergeben.
- Beträge in ganzen Cent (`Int`).
- IDs aus dem Kurzbefehl: `"sc-" + FNV-1a-32(Zeile als UTF-8)` in Hex, bei gleichen Zeilen `-1`, `-2` …
- Regelvergleich: Muster am Wortanfang im kleingeschriebenen Händlernamen, längere Muster zuerst.
- Austauschformat: die JSON-Sicherung (`app: "taler"`, `version`, `exportedAt`, `settings`, `transactions`, `rules`, `deletedIds`).
