i# Tabula Caloris / PyroScope — browser frontend

**A fast, browser-based explorer for satellite-detected fire activity, developed for the ECMWF Code for Earth 2026 PyroScope challenge.**

## Demo

The current deployment can be seen in this short demonstration:

[![Tabula Caloris / PyroScope demo](https://img.youtube.com/vi/ENZtkg4lCrE/maxresdefault.jpg)](https://youtu.be/ENZtkg4lCrE?si=Vg7cRrL3BLNJaQAn)

[Watch the demo on YouTube](https://youtu.be/ENZtkg4lCrE?si=Vg7cRrL3BLNJaQAn)

Tabula Caloris is the observational and historical-fire component developed in response to [Challenge 10 — PyroScope: Web visualisation tool for fire products](https://github.com/ECMWFCode4Earth/Challenges_2026/issues/3).

The objective is simple: make very large fire-observation archives immediately explorable, from a global multi-decadal view down to the evolution of an individual fire event, without turning the browser into the bottleneck.

The interface is designed for rapid spatial and temporal exploration of satellite hotspots: pan anywhere on Earth, move through time, identify active clusters, compare regions and seasons, and drill down from global statistics to individual detections and reconstructed fire events.

This repository is a **source snapshot of the web frontend**. It contains the static HTML, CSS, JavaScript, browser workers and visualization code. It does **not** contain the operational ingestion/processing pipeline, PHP backend, fire database, generated H3TI archives or video products used by the deployed service.

## Response to the Code for Earth challenge

The 2026 PyroScope challenge aims to improve rapid access, usability and analytical capabilities for ECMWF fire-related products, with particular emphasis on:

* interactive access rather than static maps;
* comparison with historical fire events;
* region-specific and event-specific analysis;
* near-real-time hotspot monitoring;
* rapid interpretation during active wildfire events;
* scalable and maintainable approaches for large datasets.

Tabula Caloris implements these objectives primarily on the **observational side**.

### What is implemented

**Global-to-event exploration.**
The same interface can move from a planetary view of fire activity to regional clusters and then to individual fire events and hotspot detections.

**Historical archive exploration.**
The frontend is designed to navigate a large, multi-year satellite active-fire archive and to make historical events directly accessible by place and time.

**Near-real-time hotspot monitoring.**
Recent observations are maintained separately from the historical archive so that current fire activity can be opened rapidly without first loading the full historical dataset.

**Region-specific analysis.**
Map extent, spatial selection, ranking and statistics allow the user to examine fire activity for the region currently being investigated rather than relying on pre-generated geographical products.

**Event-specific analysis.**
Individual clusters can be opened in dedicated event and analysis views, allowing the temporal and spatial construction of a fire to be examined from its satellite detections.

**Archive statistics.**
The statistics interface provides interactive comparisons across years, countries and hemispheres, including hotspot totals, cluster sizes and seasonal behaviour.

**Multiple observational perspectives.**
The Burning Earth view complements the indexed hotspot explorer with MODIS and geostationary fire visualizations.

**Fast interaction with large datasets.**
A major part of the work is the data representation itself. Compact hierarchical spatial/temporal indexes and browser workers are used so that large archives can be searched, filtered and visualized interactively. The goal is to keep exploration responsive from global archive scale down to individual events.

### Current scope

The present implementation focuses on **satellite fire observations, historical context, hotspot clustering and event reconstruction**.

ECMWF forecast products such as FWI, FOPI and PoF are **not included in this source snapshot**. The project therefore does not claim to implement the forecast-verification part of the challenge. Instead, it provides the observational, historical and event-oriented layer needed to place current or forecast fire conditions in context.

The frontend and indexing approach were designed so that additional products can be associated with the same spatial, temporal and event views in future deployments.

## Design principles

The implementation follows three main principles:

1. **Fast first interaction** — recent fire activity should be available without loading an entire global archive.
2. **Progressive detail** — global summaries, regional clusters and individual observations are different levels of the same exploration rather than separate products.
3. **Move computation away from the UI where useful** — deployment-specific ingestion and preprocessing can remain server-side, while compact indexed products are consumed efficiently by a lightweight browser client.

This separation is deliberate: the frontend remains easy to deploy and modify, while operational data production can be adapted to the available infrastructure.

## Repository contents

The repository contains static HTML, CSS and JavaScript for:

* the main fire map and timeline;
* historical archive exploration;
* archive statistics;
* recent indexed activity;
* individual event exploration;
* detailed event analysis;
* the Burning Earth visualization;
* browser-side workers for compact index decoding and statistics.

There is **no build step**.

## Run locally

From this directory:

```sh
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Use HTTP hosting rather than opening the HTML files directly because the application uses browser workers and `fetch()` requests.

## Pages and data dependencies

| Page                               | Purpose                                                         | Required data/services                                                                                     |
| ---------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `index.html`                       | Main fire map; live activity and historical archive exploration | `ARCH/H3TI/LIVE.h3ti`; `ARCH/H3TI/ARCHIVE.h3ti.zst` for history                                            |
| `stats.html`                       | Interactive archive statistics                                  | `ARCH/H3TI/ARCHIVE.h3ti.zst`; country boundaries and chart libraries are included                          |
| `track.html`                       | Recent indexed activity                                         | LIVE H3TI index                                                                                            |
| `event.html`, `eventadvanced.html` | Individual cluster/event exploration                            | Compatible `stfyhotspot.php` API; land-cover features additionally use `h3vdbinfo.php` and `h3vdcover.php` |
| `analysis.html`                    | Detailed event analysis                                         | Compatible `stfyhotspot.php` API                                                                           |
| `burningearth/index.html`          | MODIS and geostationary fire visualization                      | Separate MP4 assets listed below                                                                           |

Data requests use relative paths.

To run the main map and statistics without the operational backend, place the generated indexes at the paths above inside the served directory. The H3TI record layout is decoded in the browser by `compact_index_worker.js` and `stats-worker.js`.

The data itself is not included in this source distribution, so data-dependent pages will report loading errors until compatible indexes or services are supplied.

Event pages retain their client-side API calls, but the PHP implementations are deliberately omitted. A compatible service or reverse proxy must be provided at the expected relative URLs to enable these functions. Static hosting alone cannot execute PHP.

If the frontend is adapted to a different data origin, that service must allow the required cross-origin requests (CORS). An HTTPS-hosted frontend also requires HTTPS data endpoints.

## Burning Earth assets

`burningearth/index.html` expects the following generated video products beside it:

* `CMB_360_4k_av1_crf38_8bit_20fps_modis_web.mp4`
* `CMB_DAILY_8k_av1_crf38_8bit_24fps_mtgmask_web.mp4`

These large generated assets are not included in the source snapshot.

Some map pages also use browser libraries from CDNs as well as external map tiles and geocoding services. Their respective attribution and service terms apply. The statistics page bundles its libraries and country boundaries locally.

## Data sources

Fire observations used by the deployed system include:

* [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/)
* [IPMA / LSA SAF](https://lsa-saf.eumetsat.int/en/data/products/fire-products/)

The project was developed in the context of the **ECMWF Code for Earth 2026 PyroScope challenge** and the wider **Firecaster / Tabula Caloris** work.

## Acknowledgements

This work was developed for the [ECMWF Code for Earth 2026 PyroScope challenge](https://github.com/ECMWFCode4Earth/Challenges_2026/issues/3).

Many thanks to the challenge mentors for their discussions, feedback and support:

* Joe McNorton
* Edward Comyn-Platt
* Mark Parrington
* Chris Barnard
* Matt Menary
* Francesca Di Giuseppe

Development, algorithms, data structures, deployment and design: **Jean-Baptiste Filippi**, CNRS / University of Corsica.

Link with [FET](https://certec.mtg.eebe.upc.edu/fet-eurowest/viewer/) and FRP analysis: **Ronan Paugam**, Certec / UPC Barcelona.

## License

The original repository's **GNU GPL v3** license is preserved in `LICENSE`.

Third-party libraries retain their own licenses and notices; see `vendor/stats/`. Country boundaries are public-domain Natural Earth data. The embedded Three.js distribution in Burning Earth retains its license header.

Data, imagery and generated products have rights and terms separate from the frontend source-code license.

