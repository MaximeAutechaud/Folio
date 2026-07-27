"""Télécharge un snapshot 2 ans du scanner dans un JSON temporaire.

Usage:
    python scripts/download_scanner_backtest.py OUTPUT.json

La base Folio est ouverte en lecture seule pour récupérer l'univers. Aucune
donnée applicative n'est modifiée. Les prix viennent du même endpoint et avec
les mêmes ajustements que `fetchScannerBars`.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request


def fetch(ticker: str) -> tuple[str, list[dict], str | None]:
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(ticker, safe="")
        + "?interval=1d&range=2y&events=div%7Csplit&includeAdjustedClose=true"
    )
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
            result = data.get("chart", {}).get("result", [None])[0]
            if not result:
                return ticker, [], "empty"
            timestamps = result.get("timestamp", [])
            quote = (result.get("indicators", {}).get("quote") or [{}])[0]
            adjusted = (result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose", [])
            closes = quote.get("close", [])
            opens = quote.get("open", [])
            volumes = quote.get("volume", [])
            bars: list[dict] = []
            for i, timestamp in enumerate(timestamps):
                close = closes[i] if i < len(closes) else None
                volume = volumes[i] if i < len(volumes) else None
                if close is None or volume is None:
                    continue
                value = adjusted[i] if i < len(adjusted) and adjusted[i] is not None else close
                factor = value / close if close else 1
                raw_open = opens[i] if i < len(opens) else None
                bars.append(
                    {
                        "time": timestamp,
                        "open": raw_open * factor if raw_open is not None else value,
                        "value": value,
                        "close": close,
                        "volume": volume,
                    }
                )
            return ticker, bars, None if bars else "empty"
        except Exception as exc:  # noqa: BLE001 - rapport final par ticker
            if attempt == 2:
                return ticker, [], str(exc)
            time.sleep(1.5 * (attempt + 1))
    return ticker, [], "unreachable"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: download_scanner_backtest.py OUTPUT.json", file=sys.stderr)
        return 2
    output = os.path.abspath(sys.argv[1])
    db_path = os.path.join(os.environ["APPDATA"], "com.folio.app", "folio-dev.db")
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    universe = [
        {"ticker": ticker, "sectorId": sector_id, "source": source}
        for ticker, sector_id, source in db.execute(
            "SELECT ticker, sector_id, source FROM scanner_universe ORDER BY ticker"
        )
    ]
    db.close()

    series: dict[str, list[dict]] = {}
    errors: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch, row["ticker"]): row["ticker"] for row in universe}
        for done, future in enumerate(concurrent.futures.as_completed(futures), 1):
            ticker, bars, error = future.result()
            if bars:
                series[ticker] = bars
            if error:
                errors[ticker] = error
            if done % 25 == 0 or done == len(futures):
                print(f"{done}/{len(futures)} — {len(series)} résolus, {len(errors)} erreurs", flush=True)
            # Ralentissement léger même avec quatre workers.
            time.sleep(0.02)

    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, "w", encoding="utf-8") as handle:
        json.dump({"universe": universe, "series": series, "errors": errors}, handle)
    print(f"écrit: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
